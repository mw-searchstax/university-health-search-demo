#!/usr/bin/env python3
"""Build the six deterministic, text-based demonstration PDFs."""

from pathlib import Path
import runpy
import re
import sys
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem


ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "src/data/documents.json"
NOTICE = "Fictional demonstration website. Not a real healthcare provider."
TEAL = colors.HexColor("#12545A")


def read_source(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    blocks, paragraph = [], []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if paragraph:
                blocks.append(("paragraph", " ".join(paragraph)))
                paragraph = []
        elif stripped.startswith("#"):
            if paragraph:
                blocks.append(("paragraph", " ".join(paragraph)))
                paragraph = []
            level = len(stripped) - len(stripped.lstrip("#"))
            blocks.append(("heading", (min(level, 3), stripped[level:].strip())))
        elif re.match(r"^[-*] ", stripped):
            if paragraph:
                blocks.append(("paragraph", " ".join(paragraph)))
                paragraph = []
            blocks.append(("bullet", stripped[2:]))
        else:
            paragraph.append(stripped)
    if paragraph:
        blocks.append(("paragraph", " ".join(paragraph)))
    return blocks


def make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("DocTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=TEAL, alignment=TA_CENTER, spaceAfter=16),
        "h2": ParagraphStyle("SectionHeading", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=TEAL, spaceBefore=11, spaceAfter=5, keepWithNext=True),
        "h3": ParagraphStyle("SubHeading", parent=base["Heading3"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=TEAL, spaceBefore=8, spaceAfter=4, keepWithNext=True),
        "body": ParagraphStyle("BodyCopy", parent=base["BodyText"], fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=colors.HexColor("#26383B"), spaceAfter=7),
    }


def footer(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#D5E1DF"))
    canvas.line(document.leftMargin, 0.55 * inch, letter[0] - document.rightMargin, 0.55 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#43585B"))
    canvas.drawString(document.leftMargin, 0.37 * inch, NOTICE)
    canvas.drawRightString(letter[0] - document.rightMargin, 0.37 * inch, f"Page {document.page}")
    canvas.restoreState()


def deterministic_canvas(title, filename, **kwargs):
    kwargs.pop("invariant", None)
    output = canvas.Canvas(filename, invariant=1, **kwargs)
    output.setTitle(title)
    output.setAuthor("Alder Coast University Health - fictional demonstration")
    output.setSubject("Fictional teaching document")
    return output


def render_record(record, project_root=ROOT):
    source = project_root / record["source"]
    output = project_root / "public" / record["path"]
    blocks = read_source(source)
    if not blocks or blocks[0][0] != "heading" or blocks[0][1][1] != record["title"]:
        raise ValueError(f"{source}: first heading must match registry title {record['title']!r}")
    output.parent.mkdir(parents=True, exist_ok=True)
    styles = make_styles()
    story = [Paragraph(escape(record["title"]), styles["title"]), Spacer(1, 3)]
    bullet_items = []
    def flush_bullets():
        if bullet_items:
            story.append(ListFlowable([ListItem(Paragraph(escape(item), styles["body"]), leftIndent=10) for item in bullet_items], bulletType="bullet", start="circle", leftIndent=18, bulletFontName="Helvetica", bulletFontSize=6, spaceAfter=7))
            bullet_items.clear()
    for kind, value in blocks[1:]:
        if kind == "bullet":
            bullet_items.append(value)
            continue
        flush_bullets()
        if kind == "heading":
            level, text = value
            story.append(Paragraph(escape(text), styles["h2" if level == 2 else "h3"]))
        else:
            story.append(Paragraph(escape(value), styles["body"]))
    flush_bullets()
    doc = SimpleDocTemplate(str(output), pagesize=letter, title=record["title"], author="Alder Coast University Health - fictional demonstration", subject="Fictional teaching document", leftMargin=0.78 * inch, rightMargin=0.78 * inch, topMargin=0.72 * inch, bottomMargin=0.82 * inch)
    doc.build(story, onFirstPage=footer, onLaterPages=footer, canvasmaker=lambda filename, **kwargs: deterministic_canvas(record["title"], filename, **kwargs))
    return output


def build_all(project_root=ROOT, registry_path=REGISTRY):
    validate_registry = runpy.run_path(str(ROOT / "scripts/check-build.py"))["load_document_registry"]
    records = validate_registry(project_root=project_root, registry_path=registry_path)
    for record in records:
        source = project_root / record["source"]
        blocks = read_source(source)
        if not blocks or blocks[0][0] != "heading" or blocks[0][1][1] != record["title"]:
            raise ValueError(f"{source}: first heading must match registry title {record['title']!r}")
    expected = {record["path"] for record in records}
    public_root = project_root / "public"
    actual = {path.relative_to(public_root).as_posix() for path in public_root.rglob("*.pdf")} if public_root.exists() else set()
    extra = actual - expected
    if extra:
        raise ValueError(f"refusing to alter unregistered PDFs: {sorted(extra)}")
    built = [render_record(record, project_root) for record in records]
    print(f"Built {len(built)} PDFs: " + ", ".join(path.relative_to(public_root).as_posix() for path in built))
    return built


def main():
    build_all()


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
