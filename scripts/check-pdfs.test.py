"""Regression checks for PDF inventory, text, notice, title and safety."""

from pathlib import Path
import runpy
import json
import tempfile
import unittest

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


checks = runpy.run_path(str(Path(__file__).with_name("check-pdfs.py")))
builder = runpy.run_path(str(Path(__file__).with_name("build-pdfs.py")))
TITLE = "Sample Classroom Guide"
NOTICE = checks["NOTICE"]


class PdfCheckerTests(unittest.TestCase):
    def make_fixture(self, directory, lines, pdf_lines=None):
        root = Path(directory)
        source = root / "source.md"
        source.write_text("\n".join(lines), encoding="utf-8")
        pdf = root / "sample.pdf"
        output = canvas.Canvas(str(pdf), pagesize=letter, invariant=1)
        output.setTitle(TITLE)
        y = 740
        for line in (pdf_lines if pdf_lines is not None else lines):
            clean = line.lstrip("# -*")
            if clean:
                output.drawString(50, y, clean)
                y -= 18
        output.save()
        return pdf, source, {"title": TITLE}

    def test_extractable_text_title_notice_and_source_order_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf, source, record = self.make_fixture(directory, [f"# {TITLE}", NOTICE, "## First section", "A fictional classroom guide."])
            checks["check_document"](pdf, record, source)

    def test_missing_notice_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf, source, record = self.make_fixture(directory, [f"# {TITLE}", "## First section", "A fictional classroom guide."])
            with self.assertRaisesRegex(checks["CheckFailure"], "fictional notice"):
                checks["check_document"](pdf, record, source)

    def test_wrong_pdf_title_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf, source, record = self.make_fixture(directory, [f"# {TITLE}", NOTICE, "## First section", "A fictional classroom guide."])
            record["title"] = "Other title"
            with self.assertRaisesRegex(checks["CheckFailure"], "title metadata"):
                checks["check_document"](pdf, record, source)

    def test_missing_extra_artifacts_and_broken_source_order_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pdfs").mkdir()
            (root / "pdfs/one.pdf").touch()
            with self.assertRaisesRegex(checks["CheckFailure"], "missing=.*two.pdf"):
                checks["check_inventory"](root, {"pdfs/one.pdf", "pdfs/two.pdf"})
            (root / "pdfs/two.pdf").touch()
            (root / "pdfs/extra.pdf").touch()
            with self.assertRaisesRegex(checks["CheckFailure"], "extra=.*extra.pdf"):
                checks["check_inventory"](root, {"pdfs/one.pdf", "pdfs/two.pdf"})
        with tempfile.TemporaryDirectory() as directory:
            source_lines = [f"# {TITLE}", NOTICE, "## Second section", "## First section"]
            pdf_lines = [f"# {TITLE}", NOTICE, "## First section", "## Second section"]
            pdf, source, record = self.make_fixture(directory, source_lines, pdf_lines)
            with self.assertRaisesRegex(checks["CheckFailure"], "section order"):
                checks["check_document"](pdf, record, source)

    def test_contact_and_advice_contamination_are_rejected(self):
        for phrase, message in (("Contact us at demo@example.test", "real-service"), ("You should schedule a visit", "clinical advice")):
            with self.subTest(phrase=phrase), tempfile.TemporaryDirectory() as directory:
                pdf, source, record = self.make_fixture(directory, [f"# {TITLE}", NOTICE, "## First section", phrase])
                with self.assertRaisesRegex(checks["CheckFailure"], message):
                    checks["check_document"](pdf, record, source)

    def test_generator_rejects_malformed_or_escaping_registry_before_writing(self):
        records = json.loads((Path(__file__).parents[1] / "src/data/documents.json").read_text(encoding="utf-8"))
        for mutate in (lambda row: row.update(id="unknown-document"), lambda row: row.update(path="../escape.pdf")):
            with self.subTest(mutation=mutate), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                altered = json.loads(json.dumps(records))
                mutate(altered[0])
                registry = root / "documents.json"
                registry.write_text(json.dumps(altered), encoding="utf-8")
                with self.assertRaises(Exception):
                    builder["build_all"](root, registry)
                self.assertFalse((root / "public").exists())


if __name__ == "__main__":
    unittest.main()
