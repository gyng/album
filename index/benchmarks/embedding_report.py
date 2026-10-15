"""Build blinded visual judging artefacts, then aggregate supplied Sol grades."""

import argparse
import html
import json
import math
import random
from pathlib import Path
from urllib.parse import quote

import numpy as np
from embedding_benchmark import QUERIES as ALL_QUERIES
from embedding_benchmark import ROOT, WORK, normalise, write_json
from PIL import Image, ImageDraw, ImageFont, ImageOps

# Reduced at the user's request before the parent inspected any relevance scores.
SAMPLED_IDS = {
    "T01",
    "T02",
    "T03",
    "T06",
    "T09",
    "T11",
    "T12",
    "T16",
    "T19",
    "T21",
    "T23",
    "T24",
}
QUERIES = [query for query in ALL_QUERIES if query["id"] in SAMPLED_IDS]
TOP_K = 3

OUT = ROOT / "docs/benchmarks/embedding-2026-10-16"
SHEETS = ROOT / "docs/images/embedding-benchmark"


def dcg(grades):
    return sum(
        (2**grade - 1) / math.log2(rank + 2) for rank, grade in enumerate(grades)
    )


def ndcg(grades, ideal):
    denominator = dcg(sorted(ideal, reverse=True)[:TOP_K])
    return dcg(grades[:TOP_K]) / denominator if denominator else None


def paired_interval(differences):
    """Query bootstrap only; this does not estimate judgement uncertainty."""
    values = np.asarray(differences, dtype=np.float64)
    rng = np.random.default_rng(20261016)
    means = values[rng.integers(0, len(values), size=(10000, len(values)))].mean(axis=1)
    low, high = np.quantile(means, [0.025, 0.975])
    return {
        "mean_delta": float(values.mean()),
        "low95": float(low),
        "high95": float(high),
        "wins": int((values > 1e-9).sum()),
        "ties": int((np.abs(values) <= 1e-9).sum()),
        "losses": int((values < -1e-9).sum()),
    }


def quantise(vectors):
    scale = np.max(np.abs(vectors), axis=1, keepdims=True) / 127
    return normalise(
        np.clip(np.rint(vectors / scale), -127, 127).astype(np.int8).astype(np.float32)
        * scale
    )


def rank():
    corpus = json.loads((WORK / "corpus.json").read_text())
    existing = np.load(WORK / "existing-images.npz")
    baseline = np.load(WORK / "baseline-queries.npz")
    images = np.load(WORK / "gemma-images.npy")
    combined_path = WORK / "gemma-caption-images.npy"
    combined = np.load(combined_path) if combined_path.exists() else None
    reference = np.load(WORK / "gemma-queries.npy")
    load = lambda name: np.asarray(
        json.loads((WORK / f"{name}-queries.json").read_text()), dtype=np.float32
    )
    systems = {
        "siglip1-current-q4": (existing["siglip1"], load("siglip1-onnx-q4")),
        "siglip1-fp32": (existing["siglip1"], baseline["siglip1"]),
        "siglip2-fp32": (existing["siglip2"], baseline["siglip2"]),
        "gemma-bf16": (images, reference),
        "gemma-onnx-q4": (images, load("gemma-onnx-q4")),
        "gemma-onnx-q8": (images, load("gemma-onnx-q8")),
        "gemma-unsloth-q4": (images, load("unsloth-q4")),
        "gemma-unsloth-q8": (images, load("unsloth-q8")),
        "gemma-256d": (normalise(images[:, :256]), normalise(reference[:, :256])),
        "gemma-int8-storage-q4": (quantise(images), load("gemma-onnx-q4")),
    }
    if combined is not None:
        systems["gemma-caption-bf16"] = (combined, reference)
        systems["gemma-caption-onnx-q4"] = (combined, load("gemma-onnx-q4"))
        systems["gemma-caption-unsloth-q4"] = (combined, load("unsloth-q4"))
    q4f16 = WORK / "gemma-onnx-q4f16-queries.json"
    if q4f16.exists():
        systems["gemma-onnx-q4f16"] = (images, load("gemma-onnx-q4f16"))
    queries = list(QUERIES)
    # Fixed subject/scene references selected through the existing v2 baseline,
    # before examining any candidate model's results.
    reference_ids = ["T01", "T02", "T10", "T12", "T15", "T13"]
    for idx, text_id in enumerate(reference_ids):
        if idx not in {0, 2, 4}:
            continue
        qidx = next(i for i, q in enumerate(ALL_QUERIES) if q["id"] == text_id)
        source = int(np.argmax(existing["siglip2"] @ baseline["siglip2"][qidx]))
        queries.append(
            {
                "id": f"I{idx + 1:02}",
                "category": "image",
                "reference_index": source,
                "reference_path": corpus[source]["path"],
                "selection_query": text_id,
            }
        )
    results = {}
    for query in queries:
        qid = query["id"]
        results[qid] = {}
        if query["category"] == "image":
            source = query["reference_index"]
            active = {
                "siglip1-image": existing["siglip1"],
                "siglip2-image": existing["siglip2"],
                "gemma-image": images,
                "gemma-caption-image": combined,
            }
            scores = {
                name: matrix @ matrix[source]
                for name, matrix in active.items()
                if matrix is not None
            }
            for score in scores.values():
                score[source] = -np.inf
        else:
            qidx = next(i for i, q in enumerate(ALL_QUERIES) if q["id"] == qid)
            scores = {
                name: matrix @ qvectors[qidx]
                for name, (matrix, qvectors) in systems.items()
            }
        for name, score in scores.items():
            order = np.argsort(-score, kind="stable")[:TOP_K]
            results[qid][name] = [
                {"index": int(i), "path": corpus[i]["path"], "score": float(score[i])}
                for i in order
            ]
    OUT.mkdir(parents=True, exist_ok=True)
    write_json(OUT / "retrievals.json", {"queries": queries, "results": results})
    drift = {}
    ref_top = np.argsort(-(reference @ images.T), axis=1)[:, :TOP_K]
    for key in [
        "gemma-onnx-q4",
        "gemma-onnx-q8",
        *(["gemma-onnx-q4f16"] if q4f16.exists() else []),
        "unsloth-q4",
        "unsloth-q8",
    ]:
        query_vectors = load(key)
        cosine = np.sum(query_vectors * reference, axis=1)
        top = np.argsort(-(query_vectors @ images.T), axis=1)[:, :TOP_K]
        drift[key] = {
            "mean_cosine_to_bf16": float(cosine.mean()),
            "min_cosine_to_bf16": float(cosine.min()),
            "mean_top3_overlap": float(
                np.mean([len(set(a) & set(b)) / TOP_K for a, b in zip(ref_top, top)])
            ),
            "top1_agreement": float(np.mean(ref_top[:, 0] == top[:, 0])),
        }
    write_json(OUT / "quantisation-drift.json", drift)
    build_sheets(corpus, queries, results)


def build_sheets(corpus, queries, results):
    SHEETS.mkdir(parents=True, exist_ok=True)
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    font = ImageFont.truetype(font_path, 18)
    small = ImageFont.truetype(font_path, 14)
    manifest = {
        "rubric": "0 irrelevant, 1 weak, 2 relevant, 3 strong/complete. Judge visible semantic relevance, not aesthetics. Unknown details remain uncertain.",
        "queries": [],
        "photos": {
            f"P{i + 1:04}": {
                "path": item["path"],
                "source": str(Path(item["source"]).relative_to(ROOT)),
            }
            for i, item in enumerate(corpus)
        },
    }
    thumbs = {}

    def photo(index):
        if index not in thumbs:
            with Image.open(corpus[index]["source"]) as image:
                thumbs[index] = ImageOps.contain(
                    ImageOps.exif_transpose(image).convert("RGB"), (344, 234)
                )
        return thumbs[index]

    for query in queries:
        ids = sorted(
            {
                item["index"]
                for ranking in results[query["id"]].values()
                for item in ranking
            }
        )
        random.Random("embedding-blind-20261016-" + query["id"]).shuffle(ids)
        info = {**query, "candidates": [f"P{i + 1:04}" for i in ids], "sheets": []}
        for page in range(0, len(ids), 16):
            subset = ids[page : page + 16]
            header = 295 if query["category"] == "image" else 76
            sheet = Image.new(
                "RGB", (1440, header + math.ceil(len(subset) / 4) * 270), "#fafafa"
            )
            draw = ImageDraw.Draw(sheet)
            title = query.get(
                "text",
                "Image similarity: match the reference's defining subject and scene",
            )
            draw.text((12, 10), f"{query['id']}: {title}", font=font, fill="black")
            if query.get("meaning"):
                draw.text((12, 36), query["meaning"], font=small, fill="black")
            if query["category"] == "image":
                image = photo(query["reference_index"])
                sheet.paste(image, (12, 48))
                draw.text(
                    (370, 60), "REFERENCE (not a candidate)", font=font, fill="black"
                )
            for cell, index in enumerate(subset):
                x, y = (cell % 4) * 360, header + (cell // 4) * 270
                draw.text((x + 8, y + 3), f"P{index + 1:04}", font=font, fill="black")
                image = photo(index)
                sheet.paste(
                    image,
                    (x + (360 - image.width) // 2, y + 28 + (234 - image.height) // 2),
                )
            filename = f"{query['id']}-{page // 16 + 1}.jpg"
            sheet.save(SHEETS / filename, quality=88)
            info["sheets"].append(str((SHEETS / filename).relative_to(ROOT)))
        manifest["queries"].append(info)
    used = {pid for query in manifest["queries"] for pid in query["candidates"]}
    used.update(
        f"P{query['reference_index'] + 1:04}"
        for query in manifest["queries"]
        if query["category"] == "image"
    )
    manifest["photos"] = {
        pid: photo for pid, photo in manifest["photos"].items() if pid in used
    }
    write_json(OUT / "blind-manifest.json", manifest)
    print(
        "Built",
        len(queries),
        "blinded query sheets; candidates",
        sum(len(q["candidates"]) for q in manifest["queries"]),
        flush=True,
    )


def review():
    data = json.loads((OUT / "retrievals.json").read_text())
    scores = (
        json.loads((OUT / "scores.json").read_text())
        if (OUT / "scores.json").exists()
        else None
    )
    options, sections = [], []
    for query in data["queries"]:
        qid = query["id"]
        title = query.get(
            "text", "Image similarity: " + query.get("reference_path", "")
        )
        options.append(f'<option value="{qid}">{qid}: {html.escape(title)}</option>')
        rows = []
        for model, ranking in data["results"][qid].items():
            cards = []
            for rank_index, item in enumerate(ranking):
                album, filename = item["path"].removeprefix("../albums/").split("/", 1)
                source = (
                    "https://photos.awoo.party/data/albums/"
                    + quote(album)
                    + "/.resized_images/"
                    + quote(filename + "@800.avif")
                )
                href = (
                    "https://photos.awoo.party/album/"
                    + quote(album)
                    + "#"
                    + quote(filename)
                )
                grade = (
                    scores["per_query"][qid][model]["grades"][rank_index]
                    if scores
                    else "pending"
                )
                cards.append(
                    f'<td><a href="{html.escape(href)}"><img loading="lazy" src="{html.escape(source)}" alt="{html.escape(item["path"])}"></a><div>Grade {grade} / 3 · {item["score"]:.3f}</div></td>'
                )
            rows.append(f"<tr><th>{html.escape(model)}</th>{''.join(cards)}</tr>")
        reference = ""
        if query["category"] == "image":
            album, filename = (
                query["reference_path"].removeprefix("../albums/").split("/", 1)
            )
            source = (
                "https://photos.awoo.party/data/albums/"
                + quote(album)
                + "/.resized_images/"
                + quote(filename + "@800.avif")
            )
            reference = f'<p>Reference</p><img src="{html.escape(source)}" alt="Reference photograph">'
        sections.append(
            f'<section id="{qid}"><h2>{qid}: {html.escape(title)}</h2>{reference}<table><tbody>{"".join(rows)}</tbody></table></section>'
        )
    page = (
        '<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Embedding benchmark visual review</title><style>body{font:15px system-ui;margin:24px;background:#171717;color:#eee}select{font:inherit;max-width:100%;padding:8px}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #555;text-align:left}th{min-width:170px}td{min-width:220px}img{width:220px;height:170px;object-fit:contain}section{overflow:auto}a{color:inherit}h1{font-size:24px}</style><h1>Embedding benchmark visual review</h1><p>12 text queries and three image references. Sol relevance grades: 0 irrelevant, 1 weak, 2 relevant, 3 strong. Images load from the public gallery; the committed contact sheets work offline.</p><label>Query <select id="query">'
        + "".join(options)
        + "</select></label>"
        + "".join(sections)
        + '<script>const picker=document.querySelector("#query");function show(){for(const section of document.querySelectorAll("section"))section.hidden=section.id!==picker.value;location.hash=picker.value}if(document.getElementById(location.hash.slice(1)))picker.value=location.hash.slice(1);picker.addEventListener("change",show);show()</script></html>'
    )
    (OUT / "review.html").write_text(page)


def score():
    retrievals = json.loads((OUT / "retrievals.json").read_text())
    manifest = json.loads((OUT / "blind-manifest.json").read_text())
    grades = {}
    for path in sorted(OUT.glob("sol-grades-*.json")):
        part = json.loads(path.read_text())
        for qid, rating in part["grades"].items():
            existing = grades.setdefault(qid, {})
            overlap = existing.keys() & rating.keys()
            if overlap:
                raise ValueError(
                    f"Duplicate query/photo rating for {qid}: {sorted(overlap)}"
                )
            existing.update(rating)
    per_query = {}
    for query in manifest["queries"]:
        qid = query["id"]
        judged = grades[qid]
        if not set(query["candidates"]).issubset(judged):
            raise ValueError(
                f"Missing/extra candidates in {qid}: {set(judged) ^ set(query['candidates'])}"
            )
        numeric = {pid: judged[pid]["grade"] for pid in query["candidates"]}
        if any(
            type(grade) is not int or not 0 <= grade <= 3 for grade in numeric.values()
        ):
            raise ValueError(f"Invalid grade in {qid}")
        per_query[qid] = {}
        for model, ranking in retrievals["results"][qid].items():
            ranked_grades = [numeric[f"P{item['index'] + 1:04}"] for item in ranking]
            per_query[qid][model] = {
                "grades": ranked_grades,
                "ndcg3": ndcg(ranked_grades, numeric.values()),
                "precision3": sum(g >= 2 for g in ranked_grades) / TOP_K,
                "top1_relevant": ranked_grades[0] >= 2,
                "mean_grade": sum(ranked_grades) / TOP_K,
            }
    groups = {
        "all_text": [q["id"] for q in QUERIES],
        "english": [q["id"] for q in QUERIES if q["category"] != "multilingual"],
        "multilingual": [q["id"] for q in QUERIES if q["category"] == "multilingual"],
        "image": [q["id"] for q in manifest["queries"] if q["category"] == "image"],
    }
    aggregates = {}
    for group, ids in groups.items():
        models = sorted({model for qid in ids for model in per_query[qid]})
        aggregates[group] = {}
        for model in models:
            rows = [per_query[qid][model] for qid in ids if model in per_query[qid]]
            values = [row["ndcg3"] for row in rows if row["ndcg3"] is not None]
            aggregates[group][model] = {
                "queries": len(rows),
                "ndcg3": sum(values) / len(values) if values else None,
                "zero_gain_queries": len(rows) - len(values),
                "precision3": sum(row["precision3"] for row in rows) / len(rows),
                "top1_relevant": sum(row["top1_relevant"] for row in rows) / len(rows),
                "mean_grade": sum(row["mean_grade"] for row in rows) / len(rows),
            }
    comparisons = {}
    for group, baseline in [
        ("all_text", "siglip1-current-q4"),
        ("image", "siglip2-image"),
    ]:
        comparisons[group] = {}
        for model in aggregates[group]:
            differences = [
                per_query[qid][model]["ndcg3"] - per_query[qid][baseline]["ndcg3"]
                for qid in groups[group]
                if per_query[qid][model]["ndcg3"] is not None
                and per_query[qid][baseline]["ndcg3"] is not None
            ]
            if differences:
                comparisons[group][model] = paired_interval(differences)
    write_json(
        OUT / "scores.json",
        {
            "judge": "Sol (gpt-6.1-sol)",
            "aggregates": aggregates,
            "per_query": per_query,
            "paired_query_bootstrap": comparisons,
        },
    )
    print(json.dumps(aggregates, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["rank", "score", "review"])
    globals()[parser.parse_args().stage]()
