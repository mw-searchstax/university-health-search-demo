#!/usr/bin/env python3
"""Check PDF inventory, metadata, text extraction, source order and safety."""

from pathlib import Path
import json
import re
import sys

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "src/data/documents.json"
MANIFEST = ROOT / "docs/checkpoint-3-corpus-manifest.json"
NOTICE = "Fictional demonstration website. Not a real healthcare provider."
CONTACT = re.compile(r"(?:\b\d{3}[-.) ]?\d{3}[-. ]?\d{4}\b|\b\S+@\S+\.\S+|https?://|www\.)", re.I)
ADVICE = re.compile(r"\b(?:you should|we recommend|call your|book an appointment|schedule (?:a|your)|treatment will|cure rate|success rate)\b", re.I)


class CheckFailure(Exception):
    pass


def require(condition, path, message):
    if not condition:
        raise CheckFailure(f"{path}: {message}")


def normalize(text):
    return " ".join((text or "").replace("\u00a0", " ").split())


def markdown_text(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    output = []
    for line in lines:
        value = line.strip()
        if not value:
            continue
        value = re.sub(r"^#{1,6}\s+", "", value)
        value = re.sub(r"^[-*]\s+", "", value)
        output.append(value)
    return normalize(" ".join(output))


def markdown_lines(path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value:
            continue
        value = re.sub(r"^#{1,6}\s+", "", value)
        value = re.sub(r"^[-*]\s+", "", value)
        if value != NOTICE:
            rows.append(normalize(value))
    return rows


def check_document(pdf_path, record, source_path):
    require(pdf_path.is_file(), pdf_path, "PDF is missing")
    reader = PdfReader(str(pdf_path))
    require(not reader.is_encrypted, pdf_path, "PDF must not be encrypted")
    metadata = reader.metadata or {}
    require(metadata.title == record["title"], pdf_path, f"PDF title metadata must equal {record['title']!r}")
    extracted = normalize(" ".join(page.extract_text() or "" for page in reader.pages))
    source = markdown_text(source_path)
    require(source and extracted, pdf_path, "PDF and reviewable Markdown source must contain extractable text")
    require(NOTICE in source, source_path, "source must include the exact fictional notice")
    require(record["title"] in extracted, pdf_path, "visible document title is missing from extracted text")
    require(NOTICE in extracted, pdf_path, "exact fictional notice is missing from extractable text")
    expected_sections = [normalize(line.lstrip("# ")) for line in source_path.read_text(encoding="utf-8").splitlines() if line.startswith("## ")]
    cursor = 0
    for heading in expected_sections:
        position = extracted.find(heading, cursor)
        require(position >= cursor, pdf_path, f"section order or heading is missing: {heading}")
        cursor = position + len(heading)
    for phrase in ("call 911", "call your doctor", "contact us", "appointment phone"):
        require(phrase not in extracted.casefold(), pdf_path, f"real-service or clinical call to action found: {phrase}")
    require(not CONTACT.search(extracted), pdf_path, "contact channel or URL found in PDF text")
    require(not ADVICE.search(extracted), pdf_path, "clinical advice, outcome or service claim found in PDF text")
    cursor = 0
    for line in markdown_lines(source_path):
        position = extracted.find(line, cursor)
        require(position >= cursor, pdf_path, f"source text is missing or out of order: {line[:80]}")
        cursor = position + len(line)
    return extracted


def check_pdf_corpus(root, project_root=None):
    root = Path(root).resolve()
    project_root = Path(project_root or ROOT).resolve()
    manifest = json.loads((project_root / "docs/checkpoint-3-corpus-manifest.json").read_text(encoding="utf-8"))
    registry_path = project_root / "src/data/documents.json"
    records = json.loads(registry_path.read_text(encoding="utf-8"))
    expected = {item["id"]: item for item in manifest["pdfs"]}
    require(len(records) == 6 and {item.get("id") for item in records} == set(expected), registry_path, "registry must match the six approved PDF IDs")
    paths = {item["path"] for item in records}
    check_inventory(root, paths)
    for record in records:
        approved = expected[record["id"]]
        require(record.get("title") == approved["title"] and record.get("parent_id") == approved["parent_id"] and record.get("path") == approved["url_path"] and record.get("source") == approved["future_source_file"], registry_path, f"registry differs from manifest for {record['id']}")
        source_rel, output_rel = Path(record["source"]), Path(record["path"])
        require(not source_rel.is_absolute() and ".." not in source_rel.parts and source_rel.parts[:3] == ("src", "content", "documents"), registry_path, f"unsafe source path: {source_rel}")
        require(not output_rel.is_absolute() and ".." not in output_rel.parts and output_rel.parts[0] == "pdfs", registry_path, f"unsafe output path: {output_rel}")
        check_document(root / output_rel, record, project_root / source_rel)
    return len(records)


def check_inventory(root, expected):
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*.pdf")}
    require(actual == set(expected), root, f"expected exactly six PDFs; missing={sorted(set(expected) - actual)}, extra={sorted(actual - set(expected))}")


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "dist")
    count = check_pdf_corpus(root)
    print(f"PASS: {count} approved PDFs have stable titles, extractable source-matched text, ordered sections, and fictional notices")


if __name__ == "__main__":
    try:
        main()
    except (CheckFailure, OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
