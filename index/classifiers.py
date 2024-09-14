from abc import ABC, abstractmethod
from pathlib import Path
from joytag_model import VisionModel
import torch
import torch.amp.autocast_mode
from PIL import Image
import torchvision.transforms.functional as TVF


class BaseTagClassifier(ABC):
    @abstractmethod
    def init_model(self, model_path: str | None) -> None:
        raise NotImplemented

    @abstractmethod
    def predict_file(self, path: str) -> list[str]:
        """Predicts the tags for a file, returning a list of tags"""
        raise NotImplemented


class YoloClassifier(BaseTagClassifier):
    def init_model(self) -> None:
        from ultralytics import YOLO

        print("Loading YOLOv8...")
        self.model = YOLO("yolov8n-cls")
        print("Loaded YOLOv8.")

    def predict_file(self, path: str) -> list[str]:
        results = self.model(path, conf=0.7)
        if len(results) > 0:
            classes = results[0].names
            top5 = results[0].probs.top5
            top5_mapped = [f"{classes[x]}" for x in top5]
            return top5_mapped
        return []


class JoyTagClassifier(BaseTagClassifier):
    def init_model(self, model_path: str) -> None:

        print("Loading JoyTag...")
        self.model = VisionModel.load_model(model_path)
        self.model.eval()
        self.model = self.model.to("cuda")

    def predict_file(self, path: str) -> list[str]:
        pass

    @torch.no_grad()
    def predict_file(self, path: str) -> list[str]:
        image = Image.open(path)

        with open(Path("joytag") / "top_tags.txt", "r") as f:
            top_tags = [line.strip() for line in f.readlines() if line.strip()]

        THRESHOLD = 0.4

        image_tensor = self.prepare_image(image, self.model.image_size)
        batch = {
            "image": image_tensor.unsqueeze(0).to("cuda"),
        }

        with torch.amp.autocast_mode.autocast("cuda", enabled=True):
            preds = self.model(batch)
            tag_preds = preds["tags"].sigmoid().cpu()

        scores = {top_tags[i]: tag_preds[0][i] for i in range(len(top_tags))}
        predicted_tags = [tag for tag, score in scores.items() if score > THRESHOLD]
        tag_string = ", ".join(predicted_tags)

        return tag_string, scores

    def prepare_image(self, image: Image.Image, target_size: int) -> torch.Tensor:
        # Pad image to square
        image_shape = image.size
        max_dim = max(image_shape)
        pad_left = (max_dim - image_shape[0]) // 2
        pad_top = (max_dim - image_shape[1]) // 2

        padded_image = Image.new("RGB", (max_dim, max_dim), (255, 255, 255))
        padded_image.paste(image, (pad_left, pad_top))

        # Resize image
        if max_dim != target_size:
            padded_image = padded_image.resize(
                (target_size, target_size), Image.BICUBIC
            )

        # Convert to tensor
        image_tensor = TVF.pil_to_tensor(padded_image) / 255.0

        # Normalize
        image_tensor = TVF.normalize(
            image_tensor,
            mean=[0.48145466, 0.4578275, 0.40821073],
            std=[0.26862954, 0.26130258, 0.27577711],
        )

        return image_tensor


# if run from terminal
if __name__ == "__main__":
    # classifier = JoyTagClassifier()
    # classifier.init_model("joytag")
    # tag_string, scores = classifier.predict_file("hyouka4.bmp")
    # print(tag_string)
    # top_10_tags = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:10]
    # for tag, score in top_10_tags:
    #     print(f"{tag}: {score:.3f}")

    model = VisionModel.load_model("joytag")
    model.eval()
    model = model.to("cuda")

    tag = "burger"
    saved, paths = model.generate_image(tag, 1000)

    classifier = JoyTagClassifier()
    classifier.init_model("joytag")

    # classify generated images using paths and plot certainty of tag to verify result
    print(">progress")
    for path in paths:
        tag_string, scores = classifier.predict_file(path)
        print(f"{path} {scores[tag]} | {tag_string}")

    print(">final")
    tag_string, scores = classifier.predict_file(saved)
    top_10_tags = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:10]
    for tag, score in top_10_tags:
        print(f"{tag}: {score:.3f}")
