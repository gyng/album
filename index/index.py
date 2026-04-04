import torch
import click
from pathlib import Path, PosixPath
import pprint
import fast_colorthief
import exifread
import reverse_geocode
import sqlite3
import typing
from PIL import Image
from typing import IO, Mapping, Optional, Tuple
import os
import json
import re
import math
import tempfile
import statistics
import random
import subprocess
import shutil
from contextlib import contextmanager

from transformers import (
    AutoImageProcessor,
    AutoModel,
    AutoModelForCausalLM,
    AutoProcessor,
)

import concurrent.futures
import time


MODEL_PROFILE_JANUS = "janus"
MODEL_PROFILE_SIGLIP2 = "siglip2"
MODEL_PROFILE_HYBRID = "hybrid"
CLASSIFIER_BACKEND_JANUS = "janus"
CLASSIFIER_BACKEND_GEMMA4 = "gemma4"
CLASSIFIER_BACKEND_GEMMA4_GGUF = "gemma4-gguf"
DEFAULT_GEMMA4_MODEL_ID = "google/gemma-4-E2B-it"
DEFAULT_GEMMA4_QUANTIZATION = None
DEFAULT_GEMMA4_BATCH_SIZE = 1
DEFAULT_GEMMA4_LOW_IMPACT_HEADROOM_GB = 3.0
DEFAULT_GEMMA4_CPU_MAX_MEMORY = "24GiB"
DEFAULT_GEMMA4_GGUF_MODEL_ID = "unsloth/gemma-4-E4B-it-GGUF:Q8_0"
DEFAULT_GEMMA4_GGUF_BATCH_SIZE = 1
DEFAULT_GEMMA4_GGUF_MAX_NEW_TOKENS = 256
DEFAULT_GEMMA4_GGUF_IMAGE_MIN_TOKENS = 70
DEFAULT_GEMMA4_GGUF_IMAGE_MAX_TOKENS = 140
DEFAULT_GEMMA4_GGUF_THREADS = 8
DEFAULT_GEMMA4_GGUF_CTX_SIZE = 32768
JANUS_RESPONSE_FIELDS = (
    "identified_objects",
    "themes",
    "alt_text",
    "subject",
)
JANUS_MAX_NEW_TOKENS = 192
JANUS_BATCH_SIZE = 4
GEMMA4_MAX_NEW_TOKENS = 192
EMBEDDER_BATCH_SIZE = 16
COLORTHIEF_WORKERS = 4
INSERT_CHUNK_SIZE = 64
EXIF_SEARCH_FIELDS = (
    "Image Make",
    "Image Model",
    "EXIF LensMake",
    "EXIF LensModel",
    "EXIF LensSpecification",
    "EXIF FocalLength",
    "EXIF FocalLengthIn35mmFilm",
    "EXIF FNumber",
    "EXIF ExposureTime",
    "EXIF ISOSpeedRatings",
    "EXIF DateTimeOriginal",
    "EXIF OffsetTime",
    "GPS GPSLatitude",
    "GPS GPSLatitudeRef",
    "GPS GPSLongitude",
    "GPS GPSLongitudeRef",
)
JANUS_FALLBACK_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "its",
    "near",
    "of",
    "on",
    "or",
    "photo",
    "shows",
    "taken",
    "that",
    "the",
    "their",
    "there",
    "this",
    "to",
    "was",
    "with",
}


def build_classifier_prompt(geocode: Optional[Mapping]) -> str:
    schema = (
        '{ "identified_objects": string[], "themes": string[], '
        '"alt_text": string, "subject": string }'
    )

    location_hint = ""
    if geocode:
        city = geocode.get("city", "")
        country = geocode.get("country", "")
        place = ", ".join([part for part in [city, country] if part])
        if place:
            location_hint = f" The photo was taken near {place}. Use that only when it is visually relevant."

    return (
        "Return strict JSON only. "
        "Describe the photo for search indexing using this schema: "
        f"{schema}."
        " Keep identified_objects and themes short and concrete."
        " Keep alt_text and subject concise, factual, and literal."
        " Do not return prose outside the JSON object."
        f"{location_hint}"
    )


def build_janus_prompt(geocode: Optional[Mapping]) -> str:
    return f"<image_placeholder>{build_classifier_prompt(geocode)}"


def keywordise_text(text: str, limit: int = 6) -> list[str]:
    keywords = []
    for word in re.findall(r"[A-Za-z][A-Za-z0-9_-]+", text.lower()):
        if len(word) < 4 or word in JANUS_FALLBACK_STOPWORDS:
            continue
        normalised = word.replace("-", "_")
        if normalised in keywords:
            continue
        keywords.append(normalised)
        if len(keywords) >= limit:
            break
    return keywords


def parse_classifier_response(raw_result: str) -> Mapping[str, typing.Any]:
    JSON_BLOCK_PATTERN = re.compile(r"\{.*?\}", re.DOTALL | re.MULTILINE)
    blocks = JSON_BLOCK_PATTERN.findall(raw_result)

    if len(blocks) > 0:
        result = None
        last_error = None
        for block in reversed(blocks):
            try:
                result = json.loads(block)
                break
            except json.JSONDecodeError as err:
                last_error = err
        if result is None:
            raise last_error or ValueError("No valid JSON block found")
    else:
        cleaned = " ".join(raw_result.split()).strip()
        if not cleaned:
            raise ValueError("Empty Janus response")
        keywords = keywordise_text(cleaned)
        subject = cleaned.split(".")[0].strip() or cleaned[:160]
        result = {
            "identified_objects": keywords,
            "themes": [],
            "alt_text": cleaned,
            "subject": subject,
        }

    if not isinstance(result, dict):
        raise ValueError("Janus response was not an object")
    if isinstance(result.get("identified_objects"), str):
        result["identified_objects"] = [result["identified_objects"]]
    if isinstance(result.get("themes"), str):
        result["themes"] = [result["themes"]]
    for field in JANUS_RESPONSE_FIELDS:
        result[field]
    return result


def parse_janus_response(raw_result: str) -> Mapping[str, typing.Any]:
    return parse_classifier_response(raw_result)


def filter_exif_for_search(
    exif: Optional[Mapping[str, typing.Any]],
) -> Mapping[str, typing.Any]:
    if not exif or not hasattr(exif, "get"):
        return {}

    filtered = {}
    for field in EXIF_SEARCH_FIELDS:
        value = exif.get(field)
        if value is None:
            continue
        resolved = str(value).strip()
        if resolved == "":
            continue
        filtered[field] = value
    return filtered


class BaseCaptionClassifier:
    backend = "base"
    batch_size = 1

    def init_model(self) -> None:
        raise NotImplementedError

    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        raise NotImplementedError

    def predict_batch(self, items: list[tuple[str, Optional[Mapping]]]) -> list[str]:
        return [self.predict(path, geocode) for path, geocode in items]


class JanusClassifier(BaseCaptionClassifier):
    backend = CLASSIFIER_BACKEND_JANUS
    batch_size = JANUS_BATCH_SIZE

    def _import_janus_modules(self):
        # Janus currently expects pre-Transformers-5 PretrainedConfig subclass behaviour.
        # The temporary shim keeps Janus importable while the rest of the process uses the
        # newer Gemma-capable transformers build.
        from transformers import PretrainedConfig

        original_init_subclass = PretrainedConfig.__init_subclass__

        def compat_init_subclass(cls, **kwargs):
            return super(PretrainedConfig, cls).__init_subclass__(**kwargs)

        PretrainedConfig.__init_subclass__ = classmethod(compat_init_subclass)
        try:
            from janus.models import MultiModalityCausalLM, VLChatProcessor
            from janus.utils.io import load_pil_images
        finally:
            PretrainedConfig.__init_subclass__ = original_init_subclass

        return MultiModalityCausalLM, VLChatProcessor, load_pil_images

    def init_model(self) -> None:
        print("Loading Janus-Pro-1B...")
        # use 1B for speed/lower requirements
        model_path = "deepseek-ai/Janus-Pro-1B"
        MultiModalityCausalLM, VLChatProcessor, load_pil_images = (
            self._import_janus_modules()
        )
        self._load_pil_images = load_pil_images
        self.vl_chat_processor = VLChatProcessor.from_pretrained(model_path)
        self.tokenizer = self.vl_chat_processor.tokenizer

        vl_gpt = AutoModelForCausalLM.from_pretrained(
            model_path, trust_remote_code=True
        )
        self.vl_gpt = vl_gpt.to(torch.bfloat16).cuda().eval()
        print("Loaded Janus-Pro-1B.")

    @torch.inference_mode()
    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        prompt = build_janus_prompt(geocode)

        conversation = [
            {
                "role": "User",
                "content": prompt,
                "images": [path],
            },
            {"role": "Assistant", "content": ""},
        ]

        # load images and prepare for inputs
        # Janus-Pro will resize images internally
        pil_images = self._load_pil_images(conversation)

        prepare_inputs = self.vl_chat_processor(
            conversations=conversation, images=pil_images, force_batchify=True
        ).to(self.vl_gpt.device)

        # run image encoder to get the image embeddings
        inputs_embeds = self.vl_gpt.prepare_inputs_embeds(**prepare_inputs)

        outputs = self.vl_gpt.language_model.generate(
            inputs_embeds=inputs_embeds,
            attention_mask=prepare_inputs.attention_mask,
            pad_token_id=self.tokenizer.eos_token_id,
            bos_token_id=self.tokenizer.bos_token_id,
            eos_token_id=self.tokenizer.eos_token_id,
            max_new_tokens=JANUS_MAX_NEW_TOKENS,
            do_sample=False,
            use_cache=True,
        )

        answer = self.tokenizer.decode(
            outputs[0].cpu().tolist(), skip_special_tokens=True
        )
        return answer

    @torch.inference_mode()
    def predict_batch(self, items: list[tuple[str, Optional[Mapping]]]) -> list[str]:
        """Run Janus inference on a batch of images in one GPU forward pass."""
        if not items:
            return []
        if len(items) == 1:
            return [self.predict(items[0][0], items[0][1])]

        all_embeds = []
        all_masks = []

        for path, geocode in items:
            prompt = build_janus_prompt(geocode)
            conversation = [
                {"role": "User", "content": prompt, "images": [path]},
                {"role": "Assistant", "content": ""},
            ]
            pil_images = self._load_pil_images(conversation)
            prepare_inputs = self.vl_chat_processor(
                conversations=conversation, images=pil_images, force_batchify=True
            ).to(self.vl_gpt.device)
            embeds = self.vl_gpt.prepare_inputs_embeds(**prepare_inputs)
            all_embeds.append(embeds)
            all_masks.append(prepare_inputs.attention_mask)

        # Left-pad to the longest sequence (standard for decoder-only batch generation)
        max_len = max(e.shape[1] for e in all_embeds)
        embed_dim = all_embeds[0].shape[2]
        device = all_embeds[0].device
        dtype = all_embeds[0].dtype

        padded_embeds = []
        padded_masks = []
        for embeds, mask in zip(all_embeds, all_masks):
            pad_len = max_len - embeds.shape[1]
            if pad_len > 0:
                pad = torch.zeros(1, pad_len, embed_dim, device=device, dtype=dtype)
                embeds = torch.cat([pad, embeds], dim=1)
                mask_pad = torch.zeros(1, pad_len, device=device, dtype=mask.dtype)
                mask = torch.cat([mask_pad, mask], dim=1)
            padded_embeds.append(embeds)
            padded_masks.append(mask)

        batched_embeds = torch.cat(padded_embeds, dim=0)
        batched_masks = torch.cat(padded_masks, dim=0)

        outputs = self.vl_gpt.language_model.generate(
            inputs_embeds=batched_embeds,
            attention_mask=batched_masks,
            pad_token_id=self.tokenizer.eos_token_id,
            bos_token_id=self.tokenizer.bos_token_id,
            eos_token_id=self.tokenizer.eos_token_id,
            max_new_tokens=JANUS_MAX_NEW_TOKENS,
            do_sample=False,
            use_cache=True,
        )

        return [
            self.tokenizer.decode(output.cpu().tolist(), skip_special_tokens=True)
            for output in outputs
        ]


class Gemma4Classifier(BaseCaptionClassifier):
    backend = CLASSIFIER_BACKEND_GEMMA4

    def __init__(
        self,
        model_id: str = DEFAULT_GEMMA4_MODEL_ID,
        quantization: Optional[str] = DEFAULT_GEMMA4_QUANTIZATION,
        batch_size: int = DEFAULT_GEMMA4_BATCH_SIZE,
        max_new_tokens: int = GEMMA4_MAX_NEW_TOKENS,
        gpu_headroom_gb: Optional[float] = None,
        low_impact: bool = False,
    ):
        self.model_id = model_id
        self.quantization = quantization
        self.batch_size = batch_size
        self.max_new_tokens = max_new_tokens
        self.gpu_headroom_gb = gpu_headroom_gb
        self.low_impact = low_impact
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def _build_max_memory(self) -> Optional[dict[typing.Any, str]]:
        if not torch.cuda.is_available():
            return None

        requested_headroom = self.gpu_headroom_gb
        if requested_headroom is None and self.low_impact:
            requested_headroom = DEFAULT_GEMMA4_LOW_IMPACT_HEADROOM_GB
        if requested_headroom is None:
            return None

        total_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        usable_gb = max(4.0, total_gb - requested_headroom)
        usable_mib = max(4096, int(usable_gb * 1024))
        reserved_gb = round(total_gb - (usable_mib / 1024), 2)
        print(
            "Gemma 4 headroom mode: "
            f"reserving about {reserved_gb} GiB of GPU memory for interactive work."
        )
        return {
            0: f"{usable_mib}MiB",
            "cpu": DEFAULT_GEMMA4_CPU_MAX_MEMORY,
        }

    def init_model(self) -> None:
        try:
            from transformers import AutoModelForMultimodalLM
        except ImportError as err:
            raise RuntimeError(
                "Gemma 4 full-precision support requires a newer transformers build with AutoModelForMultimodalLM. Keep Janus as the default in this environment, or install the experimental Gemma runtime separately."
            ) from err
        print(
            f"Loading Gemma 4 classifier ({self.model_id}, quantization={self.quantization or 'none'})..."
        )
        if self.quantization == "bnb-4bit":
            print(
                "Warning: local testing found Gemma 4 vision captions can become placeholder-like under bitsandbytes 4-bit quantisation. Prefer full precision for quality checks."
            )
        self.processor = AutoProcessor.from_pretrained(self.model_id)

        model_kwargs: dict[str, typing.Any] = {}
        max_memory = self._build_max_memory()
        if self.quantization == "bnb-4bit":
            try:
                from transformers import BitsAndBytesConfig
            except ImportError as err:
                raise RuntimeError(
                    "Gemma 4 4-bit loading requires bitsandbytes-compatible transformers support."
                ) from err

            compute_dtype = (
                torch.bfloat16 if torch.cuda.is_available() else torch.float32
            )
            model_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=compute_dtype,
            )
            model_kwargs["device_map"] = "auto"
            if max_memory is not None:
                model_kwargs["max_memory"] = max_memory
        else:
            model_kwargs["dtype"] = (
                torch.bfloat16 if torch.cuda.is_available() else torch.float32
            )
            if max_memory is not None:
                model_kwargs["device_map"] = "auto"
                model_kwargs["max_memory"] = max_memory

        self.model = AutoModelForMultimodalLM.from_pretrained(
            self.model_id,
            **model_kwargs,
        )
        if "device_map" not in model_kwargs:
            self.model = self.model.to(self.device)
        self.model = self.model.eval()
        print(f"Loaded Gemma 4 classifier {self.model_id}.")

    def _build_prompt(self, geocode: Optional[Mapping]) -> str:
        return build_classifier_prompt(geocode)

    def _build_inputs(
        self, path: str, geocode: Optional[Mapping]
    ) -> dict[str, torch.Tensor]:
        prompt = self._build_prompt(geocode)
        with Image.open(path) as raw_image:
            image = raw_image.convert("RGB")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        inputs = self.processor.apply_chat_template(
            messages,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            add_generation_prompt=True,
        )

        resolved_device = getattr(self.model, "device", None)
        if resolved_device is None or str(resolved_device) == "meta":
            resolved_device = self.device
        return {k: v.to(resolved_device) for k, v in inputs.items()}

    @torch.inference_mode()
    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        inputs = self._build_inputs(path, geocode)
        input_ids = inputs.get("input_ids")
        generated = self.model.generate(
            **inputs,
            max_new_tokens=self.max_new_tokens,
            do_sample=False,
            use_cache=True,
        )

        if input_ids is not None:
            prompt_len = input_ids.shape[-1]
            generated_tokens = generated[:, prompt_len:]
        else:
            generated_tokens = generated

        return self.processor.batch_decode(
            generated_tokens,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True,
        )[0]


class Gemma4GgufClassifier(BaseCaptionClassifier):
    backend = CLASSIFIER_BACKEND_GEMMA4_GGUF

    def __init__(
        self,
        model_id: str = DEFAULT_GEMMA4_GGUF_MODEL_ID,
        quantization: Optional[str] = None,
        batch_size: int = DEFAULT_GEMMA4_GGUF_BATCH_SIZE,
        max_new_tokens: int = DEFAULT_GEMMA4_GGUF_MAX_NEW_TOKENS,
        gpu_headroom_gb: Optional[float] = None,
        low_impact: bool = False,
    ):
        self.model_id = model_id
        self.quantization = quantization
        self.batch_size = batch_size
        self.max_new_tokens = max_new_tokens
        self.gpu_headroom_gb = gpu_headroom_gb
        self.low_impact = low_impact
        self.command = None
        self._json_schema_path = None

    def init_model(self) -> None:
        command = shutil.which("llama-mtmd-cli")
        if command is None:
            candidate = "/tmp/llama.cpp/build/bin/llama-mtmd-cli"
            if os.path.exists(candidate):
                command = candidate
        if command is None:
            raise RuntimeError(
                "Could not find llama-mtmd-cli. Install llama.cpp or add it to PATH."
            )
        self.command = command
        schema = {
            "type": "object",
            "properties": {
                "identified_objects": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "themes": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "alt_text": {"type": "string"},
                "subject": {"type": "string"},
            },
            "required": list(JANUS_RESPONSE_FIELDS),
            "additionalProperties": False,
        }
        schema_file = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".json",
            prefix="gemma4-gguf-schema-",
            delete=False,
            encoding="utf-8",
        )
        json.dump(schema, schema_file)
        schema_file.flush()
        schema_file.close()
        self._json_schema_path = schema_file.name
        print(
            f"Using llama.cpp Gemma 4 GGUF classifier ({self.model_id}) via {self.command}."
        )

    def _build_prompt(self, geocode: Optional[Mapping]) -> str:
        schema = (
            '{ "identified_objects": string[], "themes": string[], '
            '"alt_text": string, "subject": string }'
        )
        location_hint = ""
        if geocode:
            city = geocode.get("city", "")
            country = geocode.get("country", "")
            place = ", ".join([part for part in [city, country] if part])
            if place:
                location_hint = f" The photo was taken near {place}. Use that only when it is visually relevant."

        return (
            "Reply with strict JSON only using this schema: "
            f"{schema}."
            " Keep identified_objects and themes short and concrete."
            " Keep alt_text and subject concise, factual, and literal."
            " Do not include any reasoning, channel markers, code fences, or prose outside the JSON object."
            f"{location_hint}"
        )

    def _extract_answer_text(self, raw_output: str) -> str:
        answer = raw_output.strip()
        if "<|channel>final" in answer:
            answer = answer.split("<|channel>final", 1)[1]
        elif "<|channel>analysis" in answer:
            answer = answer.split("<|channel>analysis", 1)[-1]
        elif "<|channel>thought" in answer and "{ " in answer:
            answer = answer[answer.find("{ ") :]

        if "<|channel>" in answer:
            answer = answer.split("<|channel>", 1)[-1]
        if "<channel|>" in answer:
            answer = answer.split("<channel|>")[-1]
        answer = answer.replace("```json", "").replace("```", "").strip()
        return answer

    @torch.inference_mode()
    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        if self.command is None:
            raise RuntimeError(
                "Gemma4GgufClassifier.init_model() must be called first."
            )

        prompt = self._build_prompt(geocode)
        command = [
            self.command,
            "--image",
            path,
            "--image-min-tokens",
            str(DEFAULT_GEMMA4_GGUF_IMAGE_MIN_TOKENS),
            "--image-max-tokens",
            str(DEFAULT_GEMMA4_GGUF_IMAGE_MAX_TOKENS),
            "--ctx-size",
            str(DEFAULT_GEMMA4_GGUF_CTX_SIZE),
            "--threads",
            str(DEFAULT_GEMMA4_GGUF_THREADS),
            "--gpu-layers",
            "auto",
            "--predict",
            str(self.max_new_tokens),
            "--jinja",
            "--json-schema-file",
            self._json_schema_path,
            "--no-warmup",
            "-p",
            prompt,
        ]
        if self.model_id.endswith(".gguf") and os.path.exists(self.model_id):
            mmproj_path = self.quantization
            if mmproj_path is None:
                sibling = os.path.join(
                    os.path.dirname(self.model_id), "mmproj-BF16.gguf"
                )
                if os.path.exists(sibling):
                    mmproj_path = sibling
            if mmproj_path is None:
                raise RuntimeError(
                    "Local GGUF model path requires an mmproj file path via quantization or a sibling mmproj-BF16.gguf."
                )
            command[1:1] = ["--model", self.model_id, "--mmproj", mmproj_path]
        else:
            command[1:1] = ["--hf-repo", self.model_id]

        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            env=os.environ.copy(),
        )
        output = completed.stdout.strip()
        if not output:
            stderr = completed.stderr.strip()
            output = self._extract_answer_text(stderr)
        if not output:
            raise RuntimeError("llama.cpp returned no parseable output.")
        return self._extract_answer_text(output)


class BaseImageEmbedder:
    MODEL_ID: str

    def init_model(self) -> None:
        self.model_id = self.MODEL_ID
        print(f"Loading image embedder {self.model_id}...")
        self.processor = AutoImageProcessor.from_pretrained(self.model_id)
        self.model = AutoModel.from_pretrained(self.model_id)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = self.model.to(self.device).eval()
        print(f"Loaded image embedder {self.model_id} on {self.device}.")

    @torch.inference_mode()
    def predict_image_embedding(self, path: str) -> list[float]:
        return self.predict_image_embeddings_batch([path])[0]

    @torch.inference_mode()
    def predict_image_embeddings_batch(self, paths: list[str]) -> list[list[float]]:
        # Thread image opens — JPEG decode releases the GIL (~2.5x vs serial for large files).
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            images = list(ex.map(lambda p: Image.open(p).convert("RGB"), paths))
        inputs = self.processor(images=images, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        features = self.model.get_image_features(**inputs)
        # Normalise for cosine similarity; store as float list for SQLite JSON.
        features = torch.nn.functional.normalize(features, p=2, dim=-1)
        return features.detach().float().cpu().tolist()


class SiglipEmbedder(BaseImageEmbedder):
    MODEL_ID = "google/siglip-base-patch16-224"


class Siglip2Embedder(BaseImageEmbedder):
    MODEL_ID = "google/siglip2-base-patch16-224"


def create_classifier(
    backend: str,
    model_id: Optional[str] = None,
    quantization: Optional[str] = None,
    batch_size: Optional[int] = None,
    max_new_tokens: Optional[int] = None,
    gpu_headroom_gb: Optional[float] = None,
    low_impact: bool = False,
) -> BaseCaptionClassifier:
    if backend == CLASSIFIER_BACKEND_JANUS:
        return JanusClassifier()

    if backend == CLASSIFIER_BACKEND_GEMMA4:
        return Gemma4Classifier(
            model_id=model_id or DEFAULT_GEMMA4_MODEL_ID,
            quantization=(
                quantization
                if quantization is not None
                else DEFAULT_GEMMA4_QUANTIZATION
            ),
            batch_size=batch_size or DEFAULT_GEMMA4_BATCH_SIZE,
            max_new_tokens=max_new_tokens or GEMMA4_MAX_NEW_TOKENS,
            gpu_headroom_gb=gpu_headroom_gb,
            low_impact=low_impact,
        )

    if backend == CLASSIFIER_BACKEND_GEMMA4_GGUF:
        return Gemma4GgufClassifier(
            model_id=model_id or DEFAULT_GEMMA4_GGUF_MODEL_ID,
            quantization=quantization,
            batch_size=batch_size or DEFAULT_GEMMA4_GGUF_BATCH_SIZE,
            max_new_tokens=max_new_tokens or DEFAULT_GEMMA4_GGUF_MAX_NEW_TOKENS,
            gpu_headroom_gb=gpu_headroom_gb,
            low_impact=low_impact,
        )

    raise ValueError(f"Unsupported classifier backend: {backend}")


def convert_to_degress(value: exifread.utils.Ratio, lat_or_lng_ref: str) -> float:
    is_s_or_w = str(lat_or_lng_ref) == "W" or str(lat_or_lng_ref) == "S"
    sign = -1 if is_s_or_w else 1
    d = float(value.values[0].num) / float(value.values[0].den)
    m = float(value.values[1].num) / float(value.values[1].den)
    s = float(value.values[2].num) / float(value.values[2].den)
    return sign * (d + (m / 60.0) + (s / 3600.0))


def get_image_geocode(lat_deg: float, lng_deg: float) -> Mapping:
    # No cache: reverse_geocode.search is an in-process k-d tree lookup (~0ms).
    # A coordinate cache would rarely hit anyway — GPS precision means two photos
    # taken nearby have different float values.
    results = reverse_geocode.search([(lat_deg, lng_deg)])
    if len(results) > 0:
        return results[0]
    else:
        return {}


def get_exif(fh: IO[any]):
    tags = exifread.process_file(fh)
    return tags


def get_album_relative_path(path: str) -> str:
    # Specific hack for album project
    # album-relative is /myalbum/asdf.jpg
    p = Path(path)
    try:
        return f"/album/{p.parts[-2]}#{p.parts[-1]}"
    except Exception:
        return str(p)


def get_filename(path: str) -> str:
    return str(os.path.basename(Path(path)))


# Repository for our search + metadata table
class Sqlite3Client:
    def __init__(self, db_path: typing.Union[str, bytes, os.PathLike]):
        self.con = sqlite3.connect(db_path)
        # allows for concurrent writes...? Not sure if it has any impact
        self.con.execute("PRAGMA journal_mode=WAL;")
        self._images_columns = None

    @contextmanager
    def transaction(self):
        cur = self.con.cursor()
        cur.execute("BEGIN")
        try:
            yield cur
        except Exception:
            cur.execute("ROLLBACK")
            raise
        else:
            cur.execute("COMMIT")

    def info(self):
        version = sqlite3.sqlite_version
        entries = 0
        try:
            entries = len(self.inspect())
        except Exception:
            pass
        return {"version": version, "entries": entries}

    def setup_tables(self):
        cur = self.con.cursor()
        cur.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS images USING fts5(path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject, tokenize='porter trigram')"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS tags (tag VARCHAR PRIMARY KEY, count INTEGER DEFAULT 0)"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS metadata (path VARCHAR PRIMARY KEY, lat_deg REAL, lng_deg REAL, iso8601 TEXT)"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS embeddings (path VARCHAR NOT NULL, model_id TEXT NOT NULL, embedding_dim INTEGER, embedding_json TEXT, PRIMARY KEY(path, model_id))"
        )
        # Migrate legacy schema (PRIMARY KEY(path)) so v1 + v2 embeddings can coexist.
        embedding_columns = cur.execute("PRAGMA table_info(embeddings)").fetchall()
        pk_columns = [
            row[1]
            for row in sorted(embedding_columns, key=lambda row: row[5])
            if row[5] > 0
        ]
        if pk_columns == ["path"]:
            cur.execute("ALTER TABLE embeddings RENAME TO embeddings_legacy")
            cur.execute(
                "CREATE TABLE embeddings (path VARCHAR NOT NULL, model_id TEXT NOT NULL, embedding_dim INTEGER, embedding_json TEXT, PRIMARY KEY(path, model_id))"
            )
            cur.execute(
                "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_json) "
                "SELECT path, COALESCE(model_id, ''), embedding_dim, embedding_json FROM embeddings_legacy"
            )
            cur.execute("DROP TABLE embeddings_legacy")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_path ON embeddings(path)")
        # Optimise loads from the browser https://github.com/phiresky/sql.js-httpvfs#readme
        cur.execute("PRAGMA journal_mode = delete;")
        cur.execute("PRAGMA page_size = 1024;")
        self.con.commit()

    def optimize(self, vacuum: bool = False):
        cur = self.con.cursor()
        cur.execute("INSERT INTO images(images) VALUES ('optimize');")
        self.con.commit()
        if vacuum:
            cur.execute("VACUUM")
            self.con.commit()

    def already_exists(self, path: str) -> bool:
        cur = self.con.cursor()
        result = cur.execute(
            "SELECT 1 FROM images WHERE path = ? LIMIT 1", (path,)
        ).fetchone()
        return result is not None

    def has_embedding(self, path: str) -> bool:
        cur = self.con.cursor()
        result = cur.execute(
            "SELECT 1 FROM embeddings WHERE path = ? LIMIT 1", (path,)
        ).fetchone()
        return result is not None

    def list_image_paths(self):
        cur = self.con.cursor()
        res = cur.execute("SELECT path FROM images")
        return {row[0] for row in res.fetchall()}

    def list_embedding_paths(self, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path FROM embeddings WHERE model_id = ?",
                (model_id,),
            )
        else:
            res = cur.execute("SELECT path FROM embeddings")
        return {row[0] for row in res.fetchall()}

    def insert_geocode(self, path: str, geocode: str):
        self.insert_field(path, value=geocode, field="geocode")

    def inspect(self):
        cur = self.con.cursor()
        res = cur.execute("SELECT * FROM images")
        resolved = res.fetchall()
        return resolved

    def get_image_row(self, path: str):
        cur = self.con.cursor()
        if self._images_columns is None:
            self._images_columns = {
                row[1] for row in cur.execute("PRAGMA table_info(images)").fetchall()
            }

        ordered_fields = [
            "path",
            "album_relative_path",
            "filename",
            "geocode",
            "exif",
            "tags",
            "colors",
            "alt_text",
            "subject",
        ]
        select_fields = []
        for field in ordered_fields:
            if field in self._images_columns:
                select_fields.append(field)
            else:
                select_fields.append(f"NULL as {field}")
        statement = f"""
            SELECT {", ".join(select_fields)}
            FROM images
            WHERE path = ?
            LIMIT 1
        """
        res = cur.execute(statement, (path,))
        row = res.fetchone()
        if row is None:
            return None
        return {
            "path": row[0],
            "album_relative_path": row[1],
            "filename": row[2],
            "geocode": row[3],
            "exif": row[4],
            "tags": row[5],
            "colors": row[6],
            "alt_text": row[7],
            "subject": row[8],
        }

    def list_paths(self):
        cur = self.con.cursor()

        statement_images = """
        SELECT path
        FROM images
        """
        res = cur.execute(statement_images)
        resolved_image_paths = res.fetchall()

        statement_metadata = """
        SELECT path
        FROM metadata
        """
        res = cur.execute(statement_metadata)
        resolved_metadata_paths = res.fetchall()

        statement_embeddings = """
        SELECT path
        FROM embeddings
        """
        res = cur.execute(statement_embeddings)
        resolved_embedding_paths = res.fetchall()

        resolved_paths = {
            p[0]
            for path_list in [
                resolved_image_paths,
                resolved_metadata_paths,
                resolved_embedding_paths,
            ]
            for p in path_list
        }
        return resolved_paths

    def delete_path(self, path: str):
        cur = self.con.cursor()

        statement_images = """
        DELETE FROM images WHERE path = ?
        """
        res_images = cur.execute(
            statement_images,
            (path,),
        )

        statement_metadata = """
        DELETE FROM metadata WHERE path = ?
        """
        res_metadata = cur.execute(
            statement_metadata,
            (path,),
        )

        statement_embeddings = """
        DELETE FROM embeddings WHERE path = ?
        """
        res_embeddings = cur.execute(
            statement_embeddings,
            (path,),
        )
        cur.execute("COMMIT")

        return (res_images, res_metadata, res_embeddings)

    def search(
        self, query: str, limit: Optional[int] = 999999, offset: Optional[int] = 0
    ):

        import pprint

        pprint.pprint((query, limit, offset))

        cur = self.con.cursor()
        statement = """
        SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25
        FROM images
        WHERE images MATCH ?
        ORDER BY rank
        LIMIT ?
        OFFSET ?
        """

        limit = limit if limit is not None else 999999
        offset = offset if offset is not None else 0

        excluded_columns = "path album_relative_path"
        res = cur.execute(
            statement,
            (f"- {{{excluded_columns}}} : {query}", limit, offset),
        )

        resolved = res.fetchall()
        return resolved

    def search_tags(self, query: str, limit: Optional[int] = None):
        cur = self.con.cursor()
        res = cur.execute(
            "SELECT * FROM tags t WHERE t.tag LIKE ? ORDER BY t.count DESC;",
            (f"%{query}%",),
        )
        resolved = res.fetchall()
        return resolved

    def search_metadata(self, query: str, limit: Optional[int] = None):
        cur = self.con.cursor()
        res = cur.execute(
            "SELECT * FROM metadata m WHERE m.path LIKE ?;",
            (f"%{query}%",),
        )
        resolved = res.fetchall()
        return resolved

    def upsert_image_fields(
        self,
        path: str,
        fields: Mapping[str, typing.Any],
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.upsert_image_fields(path, fields, transactional_cur)
                return

        row_exists = cur.execute(
            "SELECT 1 FROM images WHERE path = ? LIMIT 1;",
            (path,),
        ).fetchone()
        resolved_fields = {field: value for field, value in fields.items()}

        if row_exists:
            assignments = ", ".join([f"{field} = ?" for field in resolved_fields])
            cur.execute(
                f"UPDATE images SET {assignments} WHERE path = ?;",
                [*resolved_fields.values(), path],
            )
            return

        columns = ", ".join(["path", *resolved_fields.keys()])
        placeholders = ", ".join(["?" for _ in range(len(resolved_fields) + 1)])
        cur.execute(
            f"INSERT INTO images ({columns}) VALUES ({placeholders});",
            [path, *resolved_fields.values()],
        )

    def insert_field(
        self,
        path: str,
        field: str,
        value: str,
        cur: Optional[sqlite3.Cursor] = None,
    ):
        self.upsert_image_fields(path, {field: value}, cur=cur)

    def insert_tags(
        self,
        tags: list[str],
        cur: Optional[sqlite3.Cursor] = None,
    ):
        resolved_tags = [tag for tag in tags if tag]
        if len(resolved_tags) == 0:
            return

        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_tags(resolved_tags, transactional_cur)
                return

        cur.executemany(
            "INSERT OR IGNORE INTO tags (tag, count) VALUES (?, 1);",
            [(tag,) for tag in resolved_tags],
        )
        cur.executemany(
            "UPDATE tags SET count = count + 1 WHERE tag = ?",
            [(tag,) for tag in resolved_tags],
        )

    def insert_tag(self, tag: str, cur: Optional[sqlite3.Cursor] = None):
        self.insert_tags([tag], cur=cur)

    def insert_metadata(
        self,
        path: str,
        lat_lng_deg: Tuple[float, float],
        iso8601: str,
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_metadata(path, lat_lng_deg, iso8601, transactional_cur)
                return

        cur.execute(
            "INSERT OR IGNORE INTO metadata (path, lat_deg, lng_deg, iso8601) VALUES (?, ?, ?, ?);",
            (
                path,
                lat_lng_deg[0],
                lat_lng_deg[1],
                iso8601,
            ),
        )
        cur.execute(
            "UPDATE metadata SET lat_deg = ?, lng_deg = ?, iso8601 = ? WHERE path = ?",
            (
                lat_lng_deg[0],
                lat_lng_deg[1],
                iso8601,
                path,
            ),
        )

    def insert_embedding(
        self,
        path: str,
        model_id: str,
        embedding: list[float],
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_embedding(path, model_id, embedding, transactional_cur)
                return

        embedding_json = json.dumps(embedding)
        cur.execute(
            "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_json) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(path, model_id) DO UPDATE SET embedding_dim = excluded.embedding_dim, embedding_json = excluded.embedding_json",
            (path, model_id, len(embedding), embedding_json),
        )

    def get_embedding(self, path: str, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings WHERE path = ? AND model_id = ?",
                (path, model_id),
            )
        else:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings "
                "WHERE path = ? "
                "ORDER BY CASE "
                "WHEN model_id = ? THEN 0 "
                "WHEN model_id = ? THEN 1 "
                "ELSE 2 END "
                "LIMIT 1",
                (path, Siglip2Embedder.MODEL_ID, SiglipEmbedder.MODEL_ID),
            )
        return res.fetchone()

    def list_embeddings(self, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings WHERE model_id = ?",
                (model_id,),
            )
        else:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings"
            )
        return res.fetchall()


@click.group()
@click.pass_context
def cli(ctx):
    ctx.ensure_object(dict)


@cli.command("index")
@click.option("--glob", help="glob to recursively index.")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--dry-run", is_flag=True, default=False, help="Dry run.")
@click.option(
    "--model-profile",
    type=click.Choice(
        [MODEL_PROFILE_JANUS, MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID],
        case_sensitive=False,
    ),
    default=MODEL_PROFILE_JANUS,
    help="Indexing profile: janus (legacy tags), siglip2 (embeddings), hybrid (both).",
)
@click.option(
    "--benchmark-output",
    default=None,
    help="Optional JSON file path for timing output.",
)
@click.option(
    "--classifier-backend",
    type=click.Choice(
        [
            CLASSIFIER_BACKEND_JANUS,
            CLASSIFIER_BACKEND_GEMMA4,
            CLASSIFIER_BACKEND_GEMMA4_GGUF,
        ],
        case_sensitive=False,
    ),
    default=CLASSIFIER_BACKEND_JANUS,
    help="Caption classifier backend to use when the profile includes classifier fields.",
)
@click.option(
    "--classifier-model-id",
    default=None,
    help="Optional model id for the selected classifier backend. Full Gemma defaults to google/gemma-4-E2B-it and GGUF defaults to unsloth/gemma-4-E4B-it-GGUF:Q8_0.",
)
@click.option(
    "--classifier-quantization",
    default=None,
    help="Optional quantisation mode for the classifier backend. The Transformers bnb-4bit path is not recommended for Gemma 4 vision.",
)
@click.option(
    "--classifier-batch-size",
    default=None,
    type=int,
    help="Optional caption batch size override. Janus defaults to 4; Gemma defaults to 1.",
)
@click.option(
    "--classifier-gpu-headroom-gb",
    default=None,
    type=float,
    help="Optional GPU memory headroom to keep free for Gemma 4 by offloading part of the model to CPU.",
)
@click.option(
    "--classifier-low-impact",
    is_flag=True,
    default=False,
    help="Low-impact Gemma mode: keep some GPU memory free and prefer CPU offload for background runs.",
)
def index(
    glob: str,
    dbpath: str,
    dry_run: bool,
    model_profile: str,
    benchmark_output: Optional[str],
    classifier_backend: str,
    classifier_model_id: Optional[str],
    classifier_quantization: Optional[str],
    classifier_batch_size: Optional[int],
    classifier_gpu_headroom_gb: Optional[float],
    classifier_low_impact: bool,
):
    started_at = time.perf_counter()
    db = Sqlite3Client(dbpath)
    setup_started_at = time.perf_counter()
    db.setup_tables()
    setup_ms = (time.perf_counter() - setup_started_at) * 1000
    db_info = db.info()
    print(f"Database: {db_info['entries']} entries (SQLite {db_info['version']})")
    print(f"Using model profile: {model_profile}")

    planning_started_at = time.perf_counter()
    files = find_files(".", glob)
    existing_image_paths = db.list_image_paths()
    uses_embeddings = model_profile in [MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID]
    # One bulk SELECT into a set, then O(1) membership checks per file.
    # Better than SELECT EXISTS per image which would be N SQLite round-trips.
    existing_embedding_paths_v2 = db.list_embedding_paths(
        model_id=Siglip2Embedder.MODEL_ID if uses_embeddings else None
    )
    existing_embedding_paths_v1 = db.list_embedding_paths(
        model_id=SiglipEmbedder.MODEL_ID if uses_embeddings else None
    )
    work_items = []
    for file_path in files:
        has_image = file_path in existing_image_paths
        has_embedding_v2 = file_path in existing_embedding_paths_v2
        has_embedding_v1 = file_path in existing_embedding_paths_v1
        needs_classifier = (
            model_profile in [MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID]
            and not has_image
        )
        needs_embedding_v2 = uses_embeddings and not has_embedding_v2
        needs_embedding_v1 = uses_embeddings and not has_embedding_v1

        if needs_classifier or needs_embedding_v2 or needs_embedding_v1:
            work_items.append(
                {
                    "path": file_path,
                    "needs_classifier": needs_classifier,
                    "needs_embedding_v2": needs_embedding_v2,
                    "needs_embedding_v1": needs_embedding_v1,
                }
            )
    planning_ms = (time.perf_counter() - planning_started_at) * 1000

    skipped = len(files) - len(work_items)
    print(
        f"Found {len(files)} files ({len(work_items)} to index, {skipped} already indexed) — profile: {model_profile}"
    )
    print(f"(skipping {skipped} already-indexed)")
    print(f"Analysing {len(work_items)} files needing work")
    if model_profile in [MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID]:
        print(f"Classifier backend: {classifier_backend}")

    if not dry_run and len(work_items) > 0:
        classifier = None
        embedder = None
        model_init_started_at = time.perf_counter()

        if any(item["needs_classifier"] for item in work_items):
            classifier = create_classifier(
                backend=classifier_backend,
                model_id=classifier_model_id,
                quantization=classifier_quantization,
                batch_size=classifier_batch_size,
                gpu_headroom_gb=classifier_gpu_headroom_gb,
                low_impact=classifier_low_impact,
            )
            classifier.init_model()

        embedder_v2 = None
        embedder_v1 = None
        if any(item["needs_embedding_v2"] for item in work_items):
            embedder_v2 = Siglip2Embedder()
            embedder_v2.init_model()
        if any(item["needs_embedding_v1"] for item in work_items):
            embedder_v1 = SiglipEmbedder()
            embedder_v1.init_model()

        model_init_ms = (time.perf_counter() - model_init_started_at) * 1000

        # Kick off color extraction in a background thread pool before GPU work starts.
        # fast_colorthief (Rust) releases the GIL, so it runs truly in parallel with
        # CUDA kernels on the GPU — ~2.7 min of CPU work becomes effectively free.
        all_paths = [item["path"] for item in work_items]
        colors_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=COLORTHIEF_WORKERS
        )
        colors_started_at = time.perf_counter()
        color_futures = {
            path: colors_executor.submit(fast_colorthief.get_palette, path)
            for path in all_paths
        }
        print(
            f"Color extraction started in background ({len(all_paths)} images, {COLORTHIEF_WORKERS} threads)"
        )

        # Pre-compute Janus results in batches (GPU).
        # Batching amortises KV-cache and kernel launch overhead — ~3.8x vs single-image.
        precomputed_captions: dict[str, str] = {}
        if classifier is not None:
            classifier_paths = [
                item["path"] for item in work_items if item["needs_classifier"]
            ]
            resolved_batch_size = max(1, classifier_batch_size or classifier.batch_size)
            print(
                f"Running {classifier.backend} captions in batches of {resolved_batch_size} ({len(classifier_paths)} images)..."
            )
            batch_started_at = time.perf_counter()
            for batch_start in range(0, len(classifier_paths), resolved_batch_size):
                batch_paths = classifier_paths[
                    batch_start : batch_start + resolved_batch_size
                ]
                batch_geocodes = [extract_geocode_from_path(p) for p in batch_paths]
                batch_results = classifier.predict_batch(
                    list(zip(batch_paths, batch_geocodes))
                )
                for path, raw in zip(batch_paths, batch_results):
                    precomputed_captions[path] = raw
                done = min(batch_start + resolved_batch_size, len(classifier_paths))
                print(f"  {classifier.backend} batch: {done}/{len(classifier_paths)}")
            batch_ms = (time.perf_counter() - batch_started_at) * 1000
            print(f"{classifier.backend} batch inference complete in {batch_ms:.0f}ms")

        # Pre-compute embeddings in batches (GPU, ~2x vs sequential).
        # keyed as precomputed_embeddings[path][model_id] = embedding
        precomputed_embeddings: dict[str, dict[str, list[float]]] = {}
        for embedder, needs_key in [
            (embedder_v2, "needs_embedding_v2"),
            (embedder_v1, "needs_embedding_v1"),
        ]:
            if embedder is None:
                continue
            emb_paths = [item["path"] for item in work_items if item[needs_key]]
            print(
                f"Running {embedder.model_id} embeddings in batches of {EMBEDDER_BATCH_SIZE} ({len(emb_paths)} images)..."
            )
            emb_started_at = time.perf_counter()
            for batch_start in range(0, len(emb_paths), EMBEDDER_BATCH_SIZE):
                batch_paths = emb_paths[batch_start : batch_start + EMBEDDER_BATCH_SIZE]
                batch_embeddings = embedder.predict_image_embeddings_batch(batch_paths)
                for path, embedding in zip(batch_paths, batch_embeddings):
                    precomputed_embeddings.setdefault(path, {})[
                        embedder.model_id
                    ] = embedding
            emb_ms = (time.perf_counter() - emb_started_at) * 1000
            print(f"{embedder.model_id} embeddings complete in {emb_ms:.0f}ms")

        # Collect color results (GPU work is done; colors are likely already finished).
        precomputed_colors_by_path: dict[str, list] = {}
        colors_executor.shutdown(wait=True)
        for path, fut in color_futures.items():
            precomputed_colors_by_path[path] = fut.result()
        colors_ms = (time.perf_counter() - colors_started_at) * 1000
        print(
            f"Color extraction complete in {colors_ms:.0f}ms (ran concurrently with GPU)"
        )

        enumerated = [
            (
                item_index,
                item["path"],
                classifier if item["needs_classifier"] else None,
                [
                    e
                    for e in [
                        embedder_v2 if item["needs_embedding_v2"] else None,
                        embedder_v1 if item["needs_embedding_v1"] else None,
                    ]
                    if e is not None
                ],
                precomputed_captions.get(item["path"]),
                precomputed_embeddings.get(item["path"]),
                precomputed_colors_by_path.get(item["path"]),
            )
            for item_index, item in enumerate(work_items)
        ]

        # Disable concurrency as it doesn't help performance on a RTX3080
        insert_durations_ms = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            start_time = time.perf_counter()
            analysis_durations_ms = []
            pending_results = []
            persisted_results = 0
            total_work_items = len(work_items)

            def flush_pending_results() -> None:
                nonlocal pending_results, persisted_results
                if len(pending_results) == 0:
                    return
                insert_started_at = time.perf_counter()
                insert_analysed_images_batch(db, pending_results)
                insert_durations_ms.append((time.perf_counter() - insert_started_at) * 1000)
                persisted_results += len(pending_results)
                print(
                    f"Committed {persisted_results}/{total_work_items} analysed image(s) to SQLite"
                )
                pending_results = []

            for i, result in enumerate(executor.map(analyse_image_worker, enumerated)):
                time_now = time.perf_counter()
                time_per_image = (time_now - start_time) / (i + 1)
                rate = 1 / time_per_image
                percent = i / float(total_work_items) * 100
                estimated_time_min = (total_work_items - i) * time_per_image / 60

                analysed = result.get("analysed")
                analysis_durations_ms.append((analysed.get("_duration") or 0) * 1000)

                tags = analysed.get("tags") or []
                tags_str = ", ".join(tags[:6]) if tags else "—"
                alt = analysed.get("alt_text") or analysed.get("subject") or ""
                alt_str = f" | {alt[:80]}" if alt else ""
                filename = os.path.basename(result["path"])
                print(
                    f"[{i + 1}/{total_work_items} {percent:.0f}% {rate:.2f}it/s ~{estimated_time_min:.1f}min] {filename}: {tags_str}{alt_str}"
                )
                pending_results.append(result)
                if len(pending_results) >= INSERT_CHUNK_SIZE:
                    flush_pending_results()

            # Persist tail work so reruns continue from the latest committed chunk.
            flush_pending_results()

        print(
            f"Inserted {persisted_results} images in {sum(insert_durations_ms):.0f}ms across {len(insert_durations_ms)} transaction(s)"
        )

        db.optimize()
    else:
        model_init_ms = 0.0
        analysis_durations_ms = []
        insert_durations_ms = []

    if not dry_run and analysis_durations_ms:
        stats = {
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "modelProfile": model_profile,
            "workItemCount": len(work_items),
            "medianAnalysisMs": round(statistics.median(analysis_durations_ms), 2),
        }
        stats_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), ".last-index-stats.json"
        )
        with open(stats_path, "w", encoding="utf-8") as fh:
            json.dump(stats, fh, indent=2)

    if benchmark_output:
        benchmark = {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "glob": glob,
            "dbPath": dbpath,
            "modelProfile": model_profile,
            "dryRun": dry_run,
            "fileCount": len(files),
            "workItemCount": len(work_items),
            "durationsMs": {
                "total": round((time.perf_counter() - started_at) * 1000, 2),
                "setupTables": round(setup_ms, 2),
                "planning": round(planning_ms, 2),
                "modelInit": round(model_init_ms, 2),
                "analysisTotal": round(sum(analysis_durations_ms), 2),
                "analysisMedian": (
                    round(statistics.median(analysis_durations_ms), 2)
                    if analysis_durations_ms
                    else 0.0
                ),
                "insertTotal": round(sum(insert_durations_ms), 2),
                "insertMedian": (
                    round(statistics.median(insert_durations_ms), 2)
                    if insert_durations_ms
                    else 0.0
                ),
            },
        }
        with open(benchmark_output, "w", encoding="utf-8") as fh:
            json.dump(benchmark, fh, indent=2)
        print(f"Benchmark written to {benchmark_output}")


def build_benchmark_sample(index_value: int) -> Mapping[str, typing.Any]:
    return {
        "exif": {"Make": "Fuji", "Model": "X100V", "Index": str(index_value)},
        "geocode": {"country": "Japan", "city": "Tokyo", "country_code": "JP"},
        "lat_deg": 35.0,
        "lng_deg": 139.0,
        "colors": [(1, 2, 3), (4, 5, 6), (7, 8, 9)],
        "tags": ["street", "night", "tokyo"],
        "alt_text": "Night street scene",
        "subject": "street",
        "embedding": [0.1, 0.2, 0.3, 0.4],
        "embedding_model_id": "benchmark-model",
        "iso8601": "2024-01-01T00:00:00Z",
    }


@cli.command("benchmark-index")
@click.option("--rows", default=200, help="Synthetic analysed rows to insert per run.")
@click.option("--repeat", default=3, help="How many benchmark runs to execute.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_index(rows: int, repeat: int, output: Optional[str]):
    runs = []

    for run_index in range(repeat):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, f"benchmark-{run_index}.sqlite")
            db = Sqlite3Client(dbpath)

            setup_started_at = time.perf_counter()
            db.setup_tables()
            setup_ms = (time.perf_counter() - setup_started_at) * 1000

            insert_started_at = time.perf_counter()
            row_insert_durations_ms = []
            for row_index in range(rows):
                row_started_at = time.perf_counter()
                insert_analysed_image(
                    db,
                    build_benchmark_sample(row_index),
                    f"../albums/benchmark/photo-{row_index}.jpg",
                )
                row_insert_durations_ms.append(
                    (time.perf_counter() - row_started_at) * 1000
                )
            insert_total_ms = (time.perf_counter() - insert_started_at) * 1000

            db.optimize()
            runs.append(
                {
                    "run": run_index + 1,
                    "setupMs": round(setup_ms, 2),
                    "insertTotalMs": round(insert_total_ms, 2),
                    "insertMedianMs": round(
                        statistics.median(row_insert_durations_ms), 2
                    ),
                    "insertAverageMs": round(insert_total_ms / rows, 2),
                }
            )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": rows,
        "repeat": repeat,
        "runs": runs,
        "medianSetupMs": round(statistics.median([run["setupMs"] for run in runs]), 2),
        "medianInsertTotalMs": round(
            statistics.median([run["insertTotalMs"] for run in runs]),
            2,
        ),
        "medianInsertAverageMs": round(
            statistics.median([run["insertAverageMs"] for run in runs]),
            2,
        ),
        "medianInsertMedianMs": round(
            statistics.median([run["insertMedianMs"] for run in runs]),
            2,
        ),
    }

    pprint.pprint(summary)

    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("benchmark-janus")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path to run through Janus.",
)
@click.option("--repeat", default=3, help="How many predict runs to measure.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_janus(image_path: str, repeat: int, output: Optional[str]):
    classifier = JanusClassifier()

    init_started_at = time.perf_counter()
    classifier.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    geocode = {
        "city": "Singapore",
        "country": "Singapore",
    }
    runs = []

    for run_index in range(repeat):
        started_at = time.perf_counter()
        raw_output = classifier.predict(image_path, geocode)
        duration_ms = (time.perf_counter() - started_at) * 1000
        runs.append(
            {
                "run": run_index + 1,
                "durationMs": round(duration_ms, 2),
                "outputChars": len(raw_output),
            }
        )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "medianPredictMs": round(
            statistics.median([run["durationMs"] for run in runs]),
            2,
        ),
        "medianOutputChars": round(
            statistics.median([run["outputChars"] for run in runs]),
            2,
        ),
        "runs": runs,
    }

    pprint.pprint(summary)

    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("benchmark-janus-batch")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path to use (same image repeated to fill each batch).",
)
@click.option(
    "--batch-sizes",
    default="1,2,4,6,8",
    help="Comma-separated list of batch sizes to benchmark.",
)
@click.option("--repeat", default=3, help="How many runs per batch size.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_janus_batch(
    image_path: str, batch_sizes: str, repeat: int, output: Optional[str]
):
    """Compare single-image vs batched Janus inference throughput."""
    classifier = JanusClassifier()

    init_started_at = time.perf_counter()
    classifier.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    geocode = {"city": "Singapore", "country": "Singapore"}
    sizes = [int(s.strip()) for s in batch_sizes.split(",")]

    results_by_size = {}
    for batch_size in sizes:
        items = [(image_path, geocode)] * batch_size
        runs = []
        for run_index in range(repeat):
            started_at = time.perf_counter()
            outputs = classifier.predict_batch(items)
            duration_ms = (time.perf_counter() - started_at) * 1000
            ms_per_image = duration_ms / batch_size
            runs.append(
                {
                    "run": run_index + 1,
                    "batchSize": batch_size,
                    "totalMs": round(duration_ms, 2),
                    "msPerImage": round(ms_per_image, 2),
                    "outputChars": sum(len(o) for o in outputs),
                }
            )
        median_ms_per_image = statistics.median(r["msPerImage"] for r in runs)
        results_by_size[batch_size] = {
            "runs": runs,
            "medianMsPerImage": round(median_ms_per_image, 2),
        }
        print(f"batch={batch_size}: median {median_ms_per_image:.0f}ms/image")

    single_median = (
        results_by_size[1]["medianMsPerImage"] if 1 in results_by_size else None
    )
    speedups = {}
    if single_median:
        for size, data in results_by_size.items():
            speedups[size] = round(single_median / data["medianMsPerImage"], 2)

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "resultsByBatchSize": results_by_size,
        "speedupVsSingle": speedups,
    }

    pprint.pprint(summary)

    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("benchmark-classifier")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path to run through the classifier.",
)
@click.option(
    "--backend",
    type=click.Choice(
        [
            CLASSIFIER_BACKEND_JANUS,
            CLASSIFIER_BACKEND_GEMMA4,
            CLASSIFIER_BACKEND_GEMMA4_GGUF,
        ],
        case_sensitive=False,
    ),
    default=CLASSIFIER_BACKEND_JANUS,
    help="Caption classifier backend to benchmark.",
)
@click.option(
    "--model-id",
    default=None,
    help="Optional model id override for the selected backend.",
)
@click.option(
    "--quantization",
    default=None,
    help="Optional quantisation mode, for example bnb-4bit for Gemma 4.",
)
@click.option(
    "--gpu-headroom-gb",
    default=None,
    type=float,
    help="Optional GPU memory headroom to keep free for Gemma 4 by offloading part of the model to CPU.",
)
@click.option(
    "--low-impact",
    is_flag=True,
    default=False,
    help="Low-impact Gemma mode: keep some GPU memory free and prefer CPU offload for background runs.",
)
@click.option("--repeat", default=3, help="How many predict runs to measure.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_classifier(
    image_path: str,
    backend: str,
    model_id: Optional[str],
    quantization: Optional[str],
    gpu_headroom_gb: Optional[float],
    low_impact: bool,
    repeat: int,
    output: Optional[str],
):
    classifier = create_classifier(
        backend=backend,
        model_id=model_id,
        quantization=quantization,
        gpu_headroom_gb=gpu_headroom_gb,
        low_impact=low_impact,
    )

    init_started_at = time.perf_counter()
    classifier.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    geocode = {"city": "Singapore", "country": "Singapore"}
    runs = []
    for run_index in range(repeat):
        started_at = time.perf_counter()
        raw_output = classifier.predict(image_path, geocode)
        duration_ms = (time.perf_counter() - started_at) * 1000
        parsed = parse_classifier_response(raw_output)
        runs.append(
            {
                "run": run_index + 1,
                "durationMs": round(duration_ms, 2),
                "outputChars": len(raw_output),
                "tagCount": len(parsed.get("identified_objects", []))
                + len(parsed.get("themes", [])),
                "altTextLength": len(parsed.get("alt_text") or ""),
            }
        )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "backend": backend,
        "modelId": getattr(classifier, "model_id", None),
        "quantization": getattr(classifier, "quantization", None),
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "medianPredictMs": round(
            statistics.median([run["durationMs"] for run in runs]),
            2,
        ),
        "runs": runs,
    }
    pprint.pprint(summary)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("compare-captioners")
@click.option("--glob", required=True, help="Glob of images to sample for comparison.")
@click.option(
    "--baseline-dbpath",
    default=None,
    help="Existing DB path to use as the baseline caption source.",
)
@click.option(
    "--sample-size",
    default=24,
    type=int,
    help="How many images to include in the comparison sample.",
)
@click.option(
    "--seed",
    default=7,
    type=int,
    help="Random seed for balanced album sampling.",
)
@click.option(
    "--candidate-backend",
    type=click.Choice(
        [
            CLASSIFIER_BACKEND_JANUS,
            CLASSIFIER_BACKEND_GEMMA4,
            CLASSIFIER_BACKEND_GEMMA4_GGUF,
        ],
        case_sensitive=False,
    ),
    default=CLASSIFIER_BACKEND_GEMMA4,
    help="Candidate classifier backend to compare against the current baseline DB captions.",
)
@click.option(
    "--candidate-model-id",
    default=None,
    help="Optional candidate model id override.",
)
@click.option(
    "--candidate-quantization",
    default=None,
    help="Optional candidate quantisation mode.",
)
@click.option(
    "--candidate-gpu-headroom-gb",
    default=None,
    type=float,
    help="Optional GPU memory headroom to keep free for Gemma 4 by offloading part of the model to CPU.",
)
@click.option(
    "--candidate-low-impact",
    is_flag=True,
    default=False,
    help="Low-impact Gemma mode: keep some GPU memory free and prefer CPU offload for background runs.",
)
@click.option(
    "--output-json",
    default=".caption-comparison.json",
    help="JSON artifact path for the side-by-side comparison output.",
)
@click.option(
    "--output-md",
    default=".caption-comparison.md",
    help="Markdown report path for the side-by-side review summary.",
)
def compare_captioners(
    glob: str,
    baseline_dbpath: Optional[str],
    sample_size: int,
    seed: int,
    candidate_backend: str,
    candidate_model_id: Optional[str],
    candidate_quantization: Optional[str],
    candidate_gpu_headroom_gb: Optional[float],
    candidate_low_impact: bool,
    output_json: str,
    output_md: str,
):
    files = find_files(".", glob)
    sampled_paths = sample_balanced_paths(files, sample_size=sample_size, seed=seed)
    baseline_db = Sqlite3Client(baseline_dbpath) if baseline_dbpath else None

    candidate = create_classifier(
        backend=candidate_backend,
        model_id=candidate_model_id,
        quantization=candidate_quantization,
        gpu_headroom_gb=candidate_gpu_headroom_gb,
        low_impact=candidate_low_impact,
    )
    candidate.init_model()

    rows = []
    verdict_counts = {"candidate_better": 0, "neutral": 0, "baseline_better": 0}
    parse_success = 0

    for index_value, path in enumerate(sampled_paths, start=1):
        print(
            f"[{index_value}/{len(sampled_paths)}] comparing {os.path.basename(path)}"
        )
        baseline = baseline_db.get_image_row(path) if baseline_db else None
        geocode = extract_geocode_from_path(path)
        started_at = time.perf_counter()
        candidate_raw = candidate.predict(path, geocode)
        duration_ms = (time.perf_counter() - started_at) * 1000
        try:
            candidate_parsed = parse_classifier_response(candidate_raw)
            parse_success += 1
            parse_error = None
        except Exception as err:
            candidate_parsed = {
                "identified_objects": [],
                "themes": [],
                "alt_text": "",
                "subject": "",
            }
            parse_error = str(err)
        comparison = compare_caption_payloads(baseline, candidate_parsed)
        verdict_counts[comparison["verdict"]] += 1
        rows.append(
            {
                "path": path,
                "baseline": baseline,
                "candidate": {
                    "backend": candidate_backend,
                    "modelId": getattr(candidate, "model_id", None),
                    "quantization": getattr(candidate, "quantization", None),
                    "raw": candidate_raw,
                    "parsed": candidate_parsed,
                    "parseError": parse_error,
                    "durationMs": round(duration_ms, 2),
                },
                "comparison": comparison,
            }
        )

    candidate_durations = [row["candidate"]["durationMs"] for row in rows]
    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sampleSize": len(rows),
        "candidateBackend": candidate_backend,
        "candidateModelId": getattr(candidate, "model_id", None),
        "candidateQuantization": getattr(candidate, "quantization", None),
        "candidateMedianMs": (
            round(statistics.median(candidate_durations), 2)
            if candidate_durations
            else None
        ),
        "candidateParseSuccess": parse_success,
        "verdictCounts": verdict_counts,
    }

    report = {
        "summary": summary,
        "rows": rows,
    }
    with open(output_json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    with open(output_md, "w", encoding="utf-8") as fh:
        fh.write(build_ab_report_markdown(summary, rows))

    pprint.pprint(summary)
    print(f"Comparison artifact written to {output_json}")
    print(f"Comparison report written to {output_md}")


@cli.command("benchmark-embedder-batch")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path (same image repeated to fill each batch).",
)
@click.option(
    "--model",
    default="siglip2",
    type=click.Choice(["siglip2", "siglip1"]),
    help="Which embedder to benchmark.",
)
@click.option(
    "--batch-sizes",
    default="1,2,4,8,16,32",
    help="Comma-separated list of batch sizes to benchmark.",
)
@click.option("--repeat", default=3, help="Runs per batch size.")
@click.option("--output", default=None, help="Optional JSON output file.")
def benchmark_embedder_batch(
    image_path: str, model: str, batch_sizes: str, repeat: int, output: Optional[str]
):
    """Compare single-image vs batched SigLIP embedding throughput."""
    embedder = Siglip2Embedder() if model == "siglip2" else SiglipEmbedder()

    init_started_at = time.perf_counter()
    embedder.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    sizes = [int(s.strip()) for s in batch_sizes.split(",")]
    results_by_size = {}

    # Warm up GPU before measuring
    embedder.predict_image_embeddings_batch([image_path])

    for batch_size in sizes:
        paths = [image_path] * batch_size
        seq_runs = []
        batch_runs = []
        for _ in range(repeat):
            # Sequential: N individual calls
            started_at = time.perf_counter()
            for p in paths:
                embedder.predict_image_embeddings_batch([p])
            seq_ms = (time.perf_counter() - started_at) * 1000
            seq_runs.append(round(seq_ms / batch_size, 2))

            # Batched: one forward pass for all N
            started_at = time.perf_counter()
            embedder.predict_image_embeddings_batch(paths)
            batch_ms = (time.perf_counter() - started_at) * 1000
            batch_runs.append(round(batch_ms / batch_size, 2))

        seq_median = statistics.median(seq_runs)
        batch_median = statistics.median(batch_runs)
        speedup = round(seq_median / batch_median, 2) if batch_median else None
        results_by_size[batch_size] = {
            "sequentialMsPerImage": round(seq_median, 2),
            "batchedMsPerImage": round(batch_median, 2),
            "speedup": speedup,
        }
        print(
            f"batch={batch_size:2d}: seq {seq_median:.1f}ms  batched {batch_median:.1f}ms  speedup {speedup}x"
        )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": embedder.MODEL_ID,
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "resultsByBatchSize": results_by_size,
    }
    pprint.pprint(summary)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("prune")
@click.option("--glob", help="glob to recursively index.")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--dry-run", is_flag=True, default=False, help="Dry run.")
def prune(glob: str, dbpath: str, dry_run: bool):
    db = Sqlite3Client(dbpath)
    files = find_files(".", glob)
    paths = db.list_paths()
    to_delete = [p for p in paths if p not in files]

    if dry_run:
        pprint.pprint(to_delete)
    else:
        for p in to_delete:
            _res = db.delete_path(p)
            pprint.pprint(f"deleted from db {p}")


@cli.command("search")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.search(query, limit)
    pprint.pprint(results)


@cli.command("search-tags")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search_tags(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.search_tags(query, limit)
    pprint.pprint(results)


@cli.command("search-metadata")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search_metadata(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.search_metadata(query, limit)
    pprint.pprint(results)


@cli.command("dump")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
def dump(dbpath: str):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.inspect()
    pprint.pprint(results)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) == 0 or len(b) == 0 or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


@cli.command("search-similar-path")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--path", "query_path", required=True, help="Image path to query by.")
@click.option("--limit", default=10, help="Number of similar results to return.")
@click.option(
    "--model-id",
    default=None,
    help="Optional model_id filter. Defaults to the query path's stored model_id.",
)
def search_similar_path(
    dbpath: str, query_path: str, limit: int, model_id: Optional[str]
):
    db = Sqlite3Client(dbpath)
    db.setup_tables()

    base = db.get_embedding(path=query_path, model_id=model_id)
    if not base:
        pprint.pprint([])
        return

    resolved_model_id = base[1]
    base_embedding = json.loads(base[3])

    candidates = db.list_embeddings(model_id=resolved_model_id)
    scored = []
    for path, _model_id, _dim, embedding_json in candidates:
        if path == query_path:
            continue
        candidate_embedding = json.loads(embedding_json)
        score = cosine_similarity(base_embedding, candidate_embedding)
        scored.append((path, score))

    scored = sorted(scored, key=lambda x: x[1], reverse=True)[:limit]
    pprint.pprint(scored)


@cli.command("model-info")
def model_info():
    """Print the current embedding model configuration as JSON."""
    print(json.dumps({"embeddingModelId": Siglip2Embedder.MODEL_ID}))


def format_mapping(mapping: Optional[Mapping[str, str]]) -> str:
    """Formats a mapping for insertion into sqlite via a paramaterised query"""
    if not mapping or not hasattr(mapping, "items"):
        return str(mapping)
    return "\n".join([f"{k}:{v}" for k, v in mapping.items()])


def format_mapping_values(mapping: Optional[Mapping[str, str]]) -> str:
    """Formats a mapping for insertion of values into sqlite via a paramaterised query"""
    if not mapping or not hasattr(mapping, "items"):
        return str(mapping)
    return "\n".join([str(v) for v in mapping.values()])


def find_files(directory: str, pattern: str) -> list[str]:
    """Find files from a glob pattern in a directory, ignoring case"""
    path_pattern = os.path.join(directory, pattern)
    paths: list[PosixPath] = list(
        Path(directory).glob(path_pattern, case_sensitive=False)
    )
    if len(paths) == 0 and Path(pattern).exists():
        return [str(Path(pattern))]
    return [str(p) for p in paths]


def sample_balanced_paths(
    paths: list[str], sample_size: int, seed: int = 7
) -> list[str]:
    if sample_size <= 0 or len(paths) <= sample_size:
        return list(paths)

    rng = random.Random(seed)
    grouped: dict[str, list[str]] = {}
    for path in paths:
        group = str(Path(path).parent)
        grouped.setdefault(group, []).append(path)

    groups = list(grouped.keys())
    rng.shuffle(groups)
    for group in groups:
        rng.shuffle(grouped[group])

    sampled = []
    while len(sampled) < sample_size:
        progressed = False
        for group in groups:
            if len(sampled) >= sample_size:
                break
            if grouped[group]:
                sampled.append(grouped[group].pop())
                progressed = True
        if not progressed:
            break
    return sampled


def split_tag_text(tags: Optional[str]) -> list[str]:
    if not tags:
        return []
    return [tag.strip() for tag in tags.split(",") if tag.strip()]


def compare_caption_payloads(
    baseline: Optional[Mapping[str, typing.Any]],
    candidate: Mapping[str, typing.Any],
) -> dict[str, typing.Any]:
    baseline_tags = split_tag_text((baseline or {}).get("tags"))
    candidate_tags = list(candidate.get("identified_objects") or []) + list(
        candidate.get("themes") or []
    )

    baseline_alt = (baseline or {}).get("alt_text") or ""
    candidate_alt = candidate.get("alt_text") or ""
    baseline_subject = (baseline or {}).get("subject") or ""
    candidate_subject = candidate.get("subject") or ""

    shared_tags = sorted(set(baseline_tags).intersection(candidate_tags))
    added_tags = sorted(set(candidate_tags) - set(baseline_tags))
    removed_tags = sorted(set(baseline_tags) - set(candidate_tags))
    verdict = "neutral"
    reasons = []

    if len(candidate_alt.strip()) > len(baseline_alt.strip()) + 15:
        reasons.append("candidate_alt_more_specific")
    if len(candidate_alt.strip()) + 15 < len(baseline_alt.strip()):
        reasons.append("candidate_alt_shorter")
    if len(shared_tags) >= max(1, min(len(baseline_tags), len(candidate_tags)) // 2):
        reasons.append("good_tag_overlap")
    if len(shared_tags) == 0 and baseline_tags and candidate_tags:
        reasons.append("no_tag_overlap")
    if len(added_tags) >= 2:
        reasons.append("candidate_adds_tags")
    if len(removed_tags) >= max(3, len(baseline_tags) // 2):
        reasons.append("candidate_drops_many_tags")
    if candidate_subject and candidate_subject != baseline_subject:
        reasons.append("subject_changed")

    positive_signals = {
        "candidate_alt_more_specific",
        "good_tag_overlap",
        "candidate_adds_tags",
    }
    negative_signals = {
        "candidate_alt_shorter",
        "candidate_drops_many_tags",
        "no_tag_overlap",
    }
    if {
        "candidate_drops_many_tags",
        "no_tag_overlap",
    }.issubset(set(reasons)):
        verdict = "baseline_better"
    elif {
        "candidate_alt_more_specific",
        "good_tag_overlap",
    }.issubset(set(reasons)):
        verdict = "candidate_better"
    if any(reason in positive_signals for reason in reasons) and not any(
        reason in negative_signals for reason in reasons
    ):
        verdict = "candidate_better"
    elif any(reason in negative_signals for reason in reasons) and not any(
        reason in positive_signals for reason in reasons
    ):
        verdict = "baseline_better"

    return {
        "baselineTags": baseline_tags,
        "candidateTags": candidate_tags,
        "sharedTags": shared_tags,
        "addedTags": added_tags,
        "removedTags": removed_tags,
        "baselineAltLength": len(baseline_alt),
        "candidateAltLength": len(candidate_alt),
        "baselineSubject": baseline_subject,
        "candidateSubject": candidate_subject,
        "verdict": verdict,
        "reasons": reasons,
    }


def build_ab_report_markdown(
    summary: Mapping[str, typing.Any], rows: list[Mapping[str, typing.Any]]
) -> str:
    lines = [
        "# Caption Comparison Report",
        "",
        f"- Generated: {summary['generatedAt']}",
        f"- Sample size: {summary['sampleSize']}",
        f"- Candidate backend: {summary['candidateBackend']}",
        f"- Candidate model: {summary['candidateModelId']}",
        f"- Candidate quantisation: {summary['candidateQuantization'] or 'none'}",
        f"- Parse success: {summary['candidateParseSuccess']}/{summary['sampleSize']}",
        f"- Median candidate runtime: {summary['candidateMedianMs']}ms",
        "",
        "## Aggregate verdict",
        "",
        f"- Candidate better: {summary['verdictCounts'].get('candidate_better', 0)}",
        f"- Neutral: {summary['verdictCounts'].get('neutral', 0)}",
        f"- Baseline better: {summary['verdictCounts'].get('baseline_better', 0)}",
        "",
        "## Notes",
        "",
        "- Treat this as a first-pass review artifact. It highlights structure, overlap, and specificity differences, but final promotion should still be based on side-by-side inspection.",
        "- Baseline rows come from the existing DB when available, so the comparison reflects current indexed captions rather than a re-run with potentially different Janus weights.",
        "",
        "## Sample rows",
        "",
    ]

    for row in rows:
        comparison = row["comparison"]
        lines.extend(
            [
                f"### {row['path']}",
                "",
                f"- Verdict: {comparison['verdict']}",
                f"- Reasons: {', '.join(comparison['reasons']) if comparison['reasons'] else 'none'}",
                f"- Candidate runtime: {row['candidate']['durationMs']}ms",
                "",
                "**Baseline**",
                "",
                f"- Subject: {(row.get('baseline') or {}).get('subject') or ''}",
                f"- Alt text: {(row.get('baseline') or {}).get('alt_text') or ''}",
                f"- Tags: {', '.join(comparison['baselineTags'])}",
                "",
                "**Candidate**",
                "",
                f"- Subject: {row['candidate']['parsed'].get('subject') or ''}",
                f"- Alt text: {row['candidate']['parsed'].get('alt_text') or ''}",
                f"- Tags: {', '.join(comparison['candidateTags'])}",
                "",
            ]
        )

    return "\n".join(lines)


def extract_geocode_from_path(path: str) -> Mapping:
    """Extract geocode from image EXIF. Used to supply location context before batching Janus."""
    try:
        with open(path, "rb") as fh:
            exif_full = get_exif(fh)
            exif = filter_exif_for_search(
                {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}
            )
        lat = exif.get("GPS GPSLatitude")
        lng = exif.get("GPS GPSLongitude")
        lat_ref = exif.get("GPS GPSLatitudeRef")
        lng_ref = exif.get("GPS GPSLongitudeRef")
        if lat and lng and lat_ref and lng_ref:
            lat_deg = convert_to_degress(lat, lat_ref)
            lng_deg = convert_to_degress(lng, lng_ref)
            return get_image_geocode(lat_deg, lng_deg)
    except Exception:
        pass
    return {}


def analyse_image(
    fh: IO[bytes],
    classifier: Optional[BaseCaptionClassifier],
    path: str,
    embedders: Optional[list[BaseImageEmbedder]] = None,
    precomputed_caption: Optional[str] = None,
    precomputed_embeddings: Optional[dict[str, list[float]]] = None,
    precomputed_colors: Optional[list] = None,
) -> Mapping:
    start_time = time.perf_counter()

    exif_full = get_exif(fh)
    exif = filter_exif_for_search(
        {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}
    )

    lat = exif.get("GPS GPSLatitude", None)
    lng = exif.get("GPS GPSLongitude", None)
    lat_ref = exif.get("GPS GPSLatitudeRef", None)
    lng_ref = exif.get("GPS GPSLongitudeRef", None)

    if lat and lng and lat_ref and lng_ref:
        lat_deg = convert_to_degress(lat, lat_ref)
        lng_deg = convert_to_degress(lng, lng_ref)
        geo = get_image_geocode(lat_deg, lng_deg)
    else:
        lat_deg = None
        lng_deg = None
        geo = {}

    colors = (
        precomputed_colors
        if precomputed_colors is not None
        else fast_colorthief.get_palette(path)
    )

    result: Mapping = {}
    if classifier is not None:
        attempts = 0
        max_attempts = 20
        raw_result = None
        while attempts < max_attempts:
            try:
                if precomputed_caption is not None and attempts == 0:
                    raw_result = precomputed_caption
                else:
                    raw_result = classifier.predict(path=path, geocode=geo)

                result = parse_classifier_response(raw_result)
                break
            except Exception:
                attempts += 1
                precomputed_caption = None  # fall back to fresh per-image predictions
                print(
                    f"Attempt {attempts}/{max_attempts} failed for {path}, got {raw_result}"
                )
                if attempts >= max_attempts:
                    print(
                        f"Failed to classify {path} after {max_attempts} attempts, skipping."
                    )
                    result = {}
                    break

    embeddings = []
    for emb in embedders or []:
        try:
            precomputed = (precomputed_embeddings or {}).get(emb.model_id)
            embedding = (
                precomputed
                if precomputed is not None
                else emb.predict_image_embedding(path)
            )
            embeddings.append({"model_id": emb.model_id, "embedding": embedding})
        except Exception as err:
            print(f"Embedding ({emb.model_id}) failed for {path}: {err}")

    # 2000:01:01 12:34:56 > 2000-01-01T12:34:56
    datetime = (
        str(exif_full.get("EXIF DateTimeOriginal", ""))
        .replace(":", "-", 2)
        .replace(" ", "T", 1)
    )

    tags = [] + result.get("identified_objects", []) + result.get("themes", [])
    normalised_tags = [t.lower().replace(" ", "_") for t in list(set(tags))]

    end_time = time.perf_counter()

    return {
        # assume TZ = Z
        "datetime": f"{datetime}Z" if datetime else None,
        "exif": exif,
        "geocode": geo,
        "lat_deg": lat_deg,
        "lng_deg": lng_deg,
        "colors": colors,
        "tags": normalised_tags,
        "alt_text": result.get("alt_text"),
        "subject": result.get("subject"),
        "embeddings": embeddings,
        "_duration": end_time - start_time,
    }


def analyse_image_worker(
    input: list[
        Tuple[
            int,
            str,
            Optional[BaseCaptionClassifier],
            list[BaseImageEmbedder],
            Optional[str],
            Optional[dict],
            Optional[list],
        ]
    ],
) -> Mapping[str, typing.Any]:
    try:
        """Multiprocessable worker"""
        idx = input[0]
        path = input[1]
        classifier = input[2]
        embedders = input[3] if len(input) > 3 else []
        precomputed_caption = input[4] if len(input) > 4 else None
        precomputed_embeddings = input[5] if len(input) > 5 else None
        precomputed_colors = input[6] if len(input) > 6 else None

        print(f"[{idx + 1}] {os.path.basename(path)}...")
        with open(path, "rb") as fh:
            analysed = analyse_image(
                fh,
                classifier=classifier,
                path=path,
                embedders=embedders,
                precomputed_caption=precomputed_caption,
                precomputed_embeddings=precomputed_embeddings,
                precomputed_colors=precomputed_colors,
            )
            return {
                "path": path,
                "analysed": analysed,
                "used_classifier": classifier is not None,
            }
    except (KeyboardInterrupt, SystemExit):
        print("Exiting...")
        return (index, False)


def insert_analysed_image(
    db, analysed: Mapping, path, include_classifier_fields: bool = True
):
    geocode = analysed.get("geocode")
    image_fields = {
        "filename": get_filename(path),
        "album_relative_path": get_album_relative_path(path),
        "exif": format_mapping(analysed.get("exif")),
        "colors": format_mapping(analysed.get("colors")),
    }

    if geocode:
        image_fields["geocode"] = format_mapping_values(geocode)

    if include_classifier_fields:
        image_fields["alt_text"] = analysed.get("alt_text")
        image_fields["subject"] = analysed.get("subject")
        image_fields["tags"] = ", ".join(analysed.get("tags"))

    with db.transaction() as cur:
        db.upsert_image_fields(path, image_fields, cur=cur)

        if include_classifier_fields:
            tags_to_insert = list(analysed.get("tags") or [])
            if geocode:
                tags_to_insert.extend(
                    [
                        geocode.get("country"),
                        geocode.get("city"),
                        geocode.get("country_code"),
                    ]
                )
            db.insert_tags(tags_to_insert, cur=cur)

        db.insert_metadata(
            path,
            lat_lng_deg=(
                analysed.get("lat_deg"),
                analysed.get("lng_deg"),
            ),
            iso8601=analysed.get("iso8601"),
            cur=cur,
        )

        for emb in analysed.get("embeddings") or []:
            db.insert_embedding(
                path=path,
                model_id=emb["model_id"],
                embedding=emb["embedding"],
                cur=cur,
            )


def insert_analysed_images_batch(db, results: list[Mapping]):
    """Insert all analysed results in a single transaction.

    FTS5 flushes a segment merge on every COMMIT; batching all rows into one
    transaction eliminates that overhead (~63x faster than one txn per image).
    """
    with db.transaction() as cur:
        for item in results:
            path = item["path"]
            analysed = item["analysed"]
            include_classifier_fields = item.get("used_classifier", False)

            geocode = analysed.get("geocode")
            image_fields = {
                "filename": get_filename(path),
                "album_relative_path": get_album_relative_path(path),
                "exif": format_mapping(analysed.get("exif")),
                "colors": format_mapping(analysed.get("colors")),
            }
            if geocode:
                image_fields["geocode"] = format_mapping_values(geocode)
            if include_classifier_fields:
                image_fields["alt_text"] = analysed.get("alt_text")
                image_fields["subject"] = analysed.get("subject")
                image_fields["tags"] = ", ".join(analysed.get("tags"))

            db.upsert_image_fields(path, image_fields, cur=cur)

            if include_classifier_fields:
                tags_to_insert = list(analysed.get("tags") or [])
                if geocode:
                    tags_to_insert.extend(
                        [
                            geocode.get("country"),
                            geocode.get("city"),
                            geocode.get("country_code"),
                        ]
                    )
                db.insert_tags(tags_to_insert, cur=cur)

            db.insert_metadata(
                path,
                lat_lng_deg=(analysed.get("lat_deg"), analysed.get("lng_deg")),
                iso8601=analysed.get("iso8601"),
                cur=cur,
            )

            for emb in analysed.get("embeddings") or []:
                db.insert_embedding(
                    path=path,
                    model_id=emb["model_id"],
                    embedding=emb["embedding"],
                    cur=cur,
                )


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    cli(obj={})
