#!/usr/bin/env python3
"""Validate the approved Checkpoint 3 static-site build."""

from collections import deque
from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import posixpath
import sys
from urllib.parse import unquote, urljoin, urlsplit


BASE = "/university-health-search-demo/"
SITE = "https://mw-searchstax.github.io"
NOTICE = "Fictional demonstration website. Not a real healthcare provider."
MANIFEST = Path(__file__).resolve().parents[1] / "docs/checkpoint-3-corpus-manifest.json"
DOCUMENT_REGISTRY = Path(__file__).resolve().parents[1] / "src/data/documents.json"
SCRIPT_FIXTURES = Path(__file__).resolve().parents[1] / "src/data/script-fixtures.json"
_manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
_additions = json.loads(SCRIPT_FIXTURES.read_text(encoding="utf-8"))
_added_by_id = {row["id"]: row for row in _additions}
ROUTES = {"/" + row["slug"].strip("/") + "/": row["slug"].strip("/") + "/index.html" for row in _manifest["html"] if row["slug"]}
ROUTES.update({"/" + row["slug"].strip("/") + "/": row["slug"].strip("/") + "/index.html" for row in _additions})
ROUTES["/"] = "index.html"
PDFS = {row["url_path"]: row for row in _manifest["pdfs"]}
HTML_BY_ID = {row["id"]: row for row in _manifest["html"]}
HTML_BY_ID.update(_added_by_id)
ADDED_IDS = {
    "service-international-health", "program-business-administration", "resource-flu-shot-appointments",
    "service-general-health-services", "program-nursing-foundations", "program-nursing-community-practice",
    "program-nursing-simulation", "news-flu-clinics-2024", "news-flu-clinics-2025", "news-flu-clinics-2026",
}
ADDED_DATES = {
    "service-international-health": ("2026-03-16", "2026-10-22"),
    "program-business-administration": ("2026-03-16", "2026-10-22"),
    "resource-flu-shot-appointments": ("2026-03-16", "2026-10-22"),
    "service-general-health-services": ("2026-03-16", "2026-10-22"),
    "program-nursing-foundations": ("2026-03-16", "2026-10-22"),
    "program-nursing-community-practice": ("2026-03-16", "2026-10-22"),
    "program-nursing-simulation": ("2026-03-16", "2026-10-22"),
    "news-flu-clinics-2024": ("2024-09-15", "2024-09-15"),
    "news-flu-clinics-2025": ("2025-09-15", "2025-09-15"),
    "news-flu-clinics-2026": ("2026-09-15", "2026-09-15"),
}
ADDED_SLUGS = {
    "service-international-health": "care/services/international-health",
    "program-business-administration": "education/master-of-business-administration",
    "resource-flu-shot-appointments": "care/resources/flu-shot-appointments",
    "service-general-health-services": "care/services/general-health-services",
    "program-nursing-foundations": "education/nursing-foundations",
    "program-nursing-community-practice": "education/nursing-community-practice",
    "program-nursing-simulation": "education/nursing-simulation",
    "news-flu-clinics-2024": "news/flu-clinic-update-2024",
    "news-flu-clinics-2025": "news/flu-clinic-update-2025",
    "news-flu-clinics-2026": "news/flu-clinic-update-2026",
}
HUB_ADDITIONS = {
    "hub-care": ["service-international-health", "service-general-health-services", "resource-flu-shot-appointments"],
    "hub-education": ["program-business-administration", "program-nursing-foundations", "program-nursing-community-practice", "program-nursing-simulation"],
    "hub-news": ["news-flu-clinics-2024", "news-flu-clinics-2025", "news-flu-clinics-2026"],
}
SOURCE_SUMMARIES = {}
APPROVED_PDF_PATHS = {
    "pdfs/appointment-preparation.pdf",
    "pdfs/sleep-visit-overview.pdf",
    "pdfs/cardiology-visit-overview.pdf",
    "pdfs/nursing-program-overview.pdf",
    "pdfs/community-screening-overview.pdf",
    "pdfs/research-participation-overview.pdf",
}
REQUIRED_META = (
    "demo-content-type",
    "demo-audience",
    "demo-published-date",
    "demo-updated-date",
)
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class CheckFailure(Exception):
    pass


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.meta = {}
        self.ids = set()
        self.refs = []
        self.links = []
        self.times = []
        self.text = []
        self.body_text = []
        self.outside_body_text = []
        self.title_text = []
        self.h1_text = []
        self.title_depth = None
        self.h1_depth = None
        self.h1_count = 0
        self.main_count = 0
        self.search_body_count = 0
        self.search_body_inside_main = False
        self.search_body_invalid_container = False
        self.has_viewport = False
        self.has_lang_en = False
        self.scripts = 0
        self.forms = 0
        self.search_controls = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        in_body = any("search-body" in item["classes"] for item in self.stack)
        time_record = None
        if tag == "time":
            time_record = {"datetime": attrs.get("datetime", ""), "text": []}
            self.times.append(time_record)
        if tag not in VOID_TAGS:
            self.stack.append({"tag": tag, "classes": classes, "time": time_record,
                               "link": {"href": attrs.get("href"), "text": []} if tag == "a" else None})

        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "html":
            self.has_lang_en = attrs.get("lang", "").lower() == "en"
        if tag == "meta":
            name = (attrs.get("name") or "").lower()
            content = (attrs.get("content") or "").strip()
            if name:
                self.meta.setdefault(name, []).append(content)
            if name == "viewport" and content:
                self.has_viewport = True
        if tag == "link" and (attrs.get("rel") or "").lower() == "canonical":
            self.meta.setdefault("canonical", []).append((attrs.get("href") or "").strip())
        if tag == "title":
            self.title_depth = len(self.stack)
        if tag == "h1":
            self.h1_count += 1
            self.h1_depth = len(self.stack)
        if tag == "main":
            self.main_count += 1
        if "search-body" in classes:
            self.search_body_count += 1
            self.search_body_inside_main = any(item["tag"] == "main" for item in self.stack[:-1])
        if in_body and (tag in {"nav", "aside", "time"} or any(re.search(r"fact|related|nav|breadcrumb", item, re.I) for item in classes)):
            self.search_body_invalid_container = True
        if tag == "script":
            self.scripts += 1
        if tag == "form":
            self.forms += 1
        if tag == "search" or attrs.get("role") == "search" or (tag == "input" and attrs.get("type", "").lower() == "search"):
            self.search_controls += 1
        for attr in ("href", "src"):
            if attrs.get(attr) is not None:
                self.refs.append((tag, attr, attrs[attr], "search-body" in classes or in_body))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                if tag == "a" and self.stack[index]["link"] is not None:
                    self.links.append(self.stack[index]["link"])
                del self.stack[index:]
                break
        if tag == "title":
            self.title_depth = None
        if tag == "h1":
            self.h1_depth = None

    def handle_data(self, data):
        self.text.append(data)
        for item in self.stack:
            if item["time"] is not None:
                item["time"]["text"].append(data)
            if item["link"] is not None:
                item["link"]["text"].append(data)
        if any("search-body" in item["classes"] for item in self.stack):
            self.body_text.append(data)
        else:
            self.outside_body_text.append(data)
        if self.title_depth is not None:
            self.title_text.append(data)
        if self.h1_depth is not None:
            self.h1_text.append(data)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)


def require(condition, path, message):
    if not condition:
        raise CheckFailure(f"{path}: {message}")


def validate_frozen_manifest():
    rows = _manifest["html"]
    documents = _manifest["pdfs"]
    require(len(rows) == 86, MANIFEST, f"approved manifest must contain 86 HTML records, found {len(rows)}")
    require(len(documents) == 6, MANIFEST, f"approved manifest must contain six PDF records, found {len(documents)}")
    require(len({row["id"] for row in rows}) == 86, MANIFEST, "HTML manifest IDs must be unique")
    require(len({row["slug"] for row in rows}) == 86, MANIFEST, "HTML manifest slugs must be unique")
    require(len({row.get("source_file") for row in rows if row["id"] != "home"}) == 85, MANIFEST, "85 unique collection source files are required")
    require(sum(row["id"] == "home" for row in rows) == 1 and not next(row for row in rows if row["id"] == "home")["slug"], MANIFEST, "exactly one standalone home planning row is required")
    require(len({row["id"] for row in documents}) == 6, MANIFEST, "PDF manifest IDs must be unique")
    require(len({row["url_path"] for row in documents}) == 6, MANIFEST, "PDF manifest paths must be unique")
    require({row["url_path"] for row in documents} == APPROVED_PDF_PATHS, MANIFEST, "PDF manifest paths must match the six approved targets")
    html_ids = {row["id"] for row in rows}
    require(all(row["parent_id"] in html_ids for row in documents), MANIFEST, "every PDF parent must resolve to an HTML record")
    require(set(_added_by_id) == ADDED_IDS and len(_additions) == 10, SCRIPT_FIXTURES, "script fixture projection must contain the exact ten approved addition IDs")
    allowed = {"id", "slug", "content_type", "title", "source_file", "published_date", "updated_date", "audience", "related_ids", "service_line", "service_names", "open_for_enrollment"}
    require(all(set(row) <= allowed and {"id", "slug", "content_type", "title", "source_file", "published_date", "updated_date", "audience", "related_ids"} <= set(row) for row in _additions), SCRIPT_FIXTURES, "projection contains an undeclared field or is missing a required public-safe field")
    require(not ({row["id"] for row in _manifest["html"]} & set(_added_by_id)), SCRIPT_FIXTURES, "added fixture IDs overlap the frozen 86-record manifest")
    require(len({row["slug"] for row in _additions}) == 10 and len({row["source_file"] for row in _additions}) == 10, SCRIPT_FIXTURES, "added routes and source files must be unique")
    require(all(row["content_type"] in {"service", "program", "resource", "news"} for row in _additions), SCRIPT_FIXTURES, "additions must use an existing approved content type")
    require(all(row["content_type"] == row["id"].split("-", 1)[0] for row in _additions), SCRIPT_FIXTURES, "each added fixture content_type must match its frozen ID prefix")
    require(all((row["published_date"], row["updated_date"]) == ADDED_DATES[row["id"]] for row in _additions), SCRIPT_FIXTURES, "script fixture dates must match the fixed D-039 dates")
    require(all(row["slug"] == ADDED_SLUGS[row["id"]] for row in _additions), SCRIPT_FIXTURES, "script fixture routes must match the fixed D-039 routes")
    expected_optional = {
        "service-international-health": {"service_names": ["Travel Vaccinations"]},
        "program-nursing-foundations": {"open_for_enrollment": True},
        "program-nursing-community-practice": {"open_for_enrollment": False},
        "program-nursing-simulation": {"open_for_enrollment": True},
    }
    for row in _additions:
        require({key: row[key] for key in ("service_names", "open_for_enrollment") if key in row} == expected_optional.get(row["id"], {}), SCRIPT_FIXTURES, f"unexpected optional fields or values for {row['id']}")
    require(len({row["id"] for row in _additions}) == 10, SCRIPT_FIXTURES, "added IDs must be unique")


def normalized_text(parts):
    return " ".join(" ".join(parts).split())


def contains_cardiology(text):
    return re.search(r"\bcardiology\b", text, re.I) is not None


def check_script_lexical_controls(record_id, title, description, body, path):
    indexed = " ".join((title, description, body))
    if record_id == "program-business-administration":
        require(not re.search(r"\bmba\b", indexed, re.I), path, "business program indexed fields must exclude the MBA abbreviation")
    elif record_id == "service-international-health":
        require(not re.search(r"\b(?:travel|vaccinations)\b", indexed, re.I), path, "International Health title/description/.search-body must exclude travel and vaccinations")
    elif record_id == "resource-flu-shot-appointments":
        require(re.search(r"\bflu\s+shots\b", title, re.I), path, "appointment-information title must include exact plural flu shots")
        require(re.search(r"\bflu\s+shots\b", body, re.I), path, "appointment-information body must include exact plural flu shots")
    elif record_id == "service-general-health-services":
        require(not re.search(r"\bflu\b|\bshots\b", title + " " + description, re.I), path, "general service title/summary must omit flu and shots")
        require(re.search(r"\bflu\s+shots\b", body, re.I), path, "general service body must contain flu shots")


def check_optional_metadata(parser, row, outside_text, path):
    if row["id"] not in ADDED_IDS:
        require("demo-service-name" not in parser.meta and "demo-open-for-enrollment" not in parser.meta, path, "optional D-039 metadata must be absent from every original page")
        return
    if "service_names" in row:
        expected = row["service_names"]
        require(parser.meta.get("demo-service-name") == expected, path, "service-name metadata must serialize one exact value per declared service name")
        require(", ".join(expected) in outside_text, path, "service-name fact must be visible outside .search-body")
    else:
        require("demo-service-name" not in parser.meta, path, "service-name metadata must be absent when source field is absent")
    if "open_for_enrollment" in row:
        value = row["open_for_enrollment"]
        require(type(value) is bool, path, "projected enrollment value must be a strict Boolean")
        expected = "true" if value else "false"
        require(parser.meta.get("demo-open-for-enrollment") == [expected], path, "enrollment metadata must preserve the exact lowercase Boolean value")
        visible = "Open (fictional)" if value else "Closed (fictional)"
        require(visible in outside_text, path, "fictional enrollment fact must be visible outside .search-body")
    else:
        require("demo-open-for-enrollment" not in parser.meta, path, "enrollment metadata must be absent when source field is absent")


def route_for(relative):
    if relative == Path("index.html"):
        return "/"
    return "/" + relative.parent.as_posix().rstrip("/") + "/"


def inspect_page(root, route, relpath):
    path = root / relpath
    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()

    require(parser.has_lang_en, path, "expected <html lang=\"en\">")
    titles = normalized_text(parser.title_text)
    require(bool(titles), path, "missing non-empty <title>")
    row = next(row for row in HTML_BY_ID.values() if ("/" if not row["slug"] else "/" + row["slug"].strip("/") + "/") == route)
    if row["id"] != "home":
        require(normalized_text(parser.h1_text) == row["title"], path, f"visible h1 must match source title {row['title']!r}")
        require(parser.meta.get("demo-content-type") == [row["content_type"]], path, f"demo-content-type must match source role {row['content_type']!r}")
    descriptions = parser.meta.get("description", [])
    require(len(descriptions) == 1 and bool(descriptions[0]), path, "expected one non-empty meta description")
    expected_canonical = SITE + BASE + route.lstrip("/")
    canonicals = parser.meta.get("canonical", [])
    require(canonicals == [expected_canonical], path, f"canonical must be {expected_canonical}")
    require(parser.has_viewport, path, "missing non-empty viewport meta")
    require(parser.h1_count == 1, path, f"expected exactly one h1, found {parser.h1_count}")
    require(parser.main_count == 1, path, f"expected exactly one main, found {parser.main_count}")
    require(parser.search_body_count == 1, path, f"expected exactly one .search-body, found {parser.search_body_count}")
    require(parser.search_body_inside_main, path, ".search-body must be inside main")
    require(not parser.search_body_invalid_container, path, "facts, related content, navigation, or breadcrumbs found inside .search-body")
    require(not any(in_body and tag == "a" for tag, attr, value, in_body in parser.refs), path, "links inside .search-body must be moved outside it")
    require(not parser.scripts, path, "script element found; pages must render without browser-side scripts")
    require(not parser.forms, path, "form found; the demo has no data-submission forms")
    require(not parser.search_controls, path, "search UI found; the demo is content-only")

    for name in REQUIRED_META:
        values = parser.meta.get(name, [])
        require(bool(values) and all(values), path, f"missing non-empty {name} metadata")
    if row["id"] in ADDED_IDS:
        published, updated = ADDED_DATES[row["id"]]
        require(parser.meta.get("demo-published-date") == [published + "T00:00:00Z"], path, f"demo-published-date must equal fixed UTC instant {published}T00:00:00Z")
        require(parser.meta.get("demo-updated-date") == [updated + "T00:00:00Z"], path, f"demo-updated-date must equal fixed UTC instant {updated}T00:00:00Z")
        summary = SOURCE_SUMMARIES[row["id"]]
        require(normalized_text(parser.meta.get("description", [])) == summary, path, "description must equal the source summary")
        require(summary in normalized_text(parser.body_text), path, "source summary must appear in the detail .search-body")
    check_optional_metadata(parser, row, normalized_text(parser.outside_body_text), path)
    dates = parser.meta.get("demo-published-date", []) + parser.meta.get("demo-updated-date", [])
    iso_date = r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?"
    require(all(re.fullmatch(iso_date, value) for value in dates), path, "publication/update metadata must use ISO dates or UTC instants")
    for value in dates:
        try:
            date.fromisoformat(value[:10])
        except ValueError:
            require(False, path, f"invalid calendar date in metadata: {value}")

    text = normalized_text(parser.text)
    require(NOTICE in text, path, f"missing exact visible notice: {NOTICE}")
    body_text = normalized_text(parser.body_text)
    require(normalized_text([descriptions[0]]) in body_text, path, "meta description must also appear in .search-body text")
    searchable_copy = " ".join((titles, descriptions[0], body_text))

    if route == "/care/providers/mara-ellison/":
        has_sleep_specialty = any(v.casefold() == "sleep medicine" for v in parser.meta.get("demo-specialty", []))
        require(has_sleep_specialty, path, "provider requires demo-specialty metadata value Sleep Medicine")
        require("sleep medicine" in normalized_text(parser.outside_body_text).casefold(), path, "visible Sleep Medicine specialty must appear outside .search-body")
        require(not re.search(r"\b(?:sleep|medicine)\b", searchable_copy, re.I), path, "provider title/description/.search-body contains sleep or medicine")

    if route == "/care/resources/myocardial-infarction-terminology/":
        require(not re.search(r"\bheart\s+attack\b", searchable_copy, re.I), path, "MI resource title/description/.search-body contains heart attack")
        require(re.search(r"\bmyocardial\s+infarction\b", searchable_copy, re.I), path, "MI resource lacks myocardial infarction in title/description/.search-body")

    expected_dates = {
        "/community/community-screening/": "2026-08-15",
        "/news/community-screening-archive-2024/": "2024-04-12",
        "/news/community-screening-update-2025/": "2025-04-12",
        "/news/community-screening-update-2026/": "2026-04-12",
    }
    if route in expected_dates:
        expected_date = expected_dates[route]
        require(any(value == expected_date or value.startswith(expected_date + "T") for value in parser.meta["demo-published-date"]), path, f"published metadata must use {expected_date} (optionally as a UTC instant)")
        require(any(item["datetime"] == expected_date and normalized_text(item["text"]) for item in parser.times), path, f"rendered publication date must use <time datetime=\"{expected_date}\"> with visible text")

    if row["id"] in ADDED_IDS:
        check_script_lexical_controls(row["id"], titles, descriptions[0], body_text, path)

    return {"path": path, "parser": parser, "route": route}


def check_remaining_scenario_controls(pages):
    def page_for(record_id):
        record = HTML_BY_ID[record_id]
        return pages["/" + record["slug"].strip("/") + "/"]

    heart = page_for("resource-heart-education")
    require(re.search(r"\bheart\s+attack\b", normalized_text(heart["parser"].title_text), re.I), heart["path"], "Heart Attack Education title must preserve the literal-query comparator")
    require(re.search(r"\bheart\s+attack\b", heart["parser"].meta["description"][0], re.I), heart["path"], "Heart Attack Education summary must preserve the literal-query comparator")
    require(re.search(r"\bheart\s+attack\b", normalized_text(heart["parser"].body_text), re.I), heart["path"], "Heart Attack Education body must preserve the literal-query comparator")

    jonah = page_for("provider-jonah-fenwick")
    require(re.search(r"\bcardiology\b", normalized_text(jonah["parser"].body_text), re.I), jonah["path"], "Jonah comparator body must include cardiology")
    require(not contains_cardiology(normalized_text(jonah["parser"].title_text)), jonah["path"], "Jonah title must exclude cardiology")

    visit = page_for("resource-cardiology-visit")
    require(not contains_cardiology(normalized_text(visit["parser"].title_text)), visit["path"], "Visiting the Heart Center title must exclude cardiology")
    require(contains_cardiology(visit["parser"].meta["description"][0]), visit["path"], "Visiting the Heart Center summary must include cardiology")
    require(contains_cardiology(normalized_text(visit["parser"].body_text)), visit["path"], "Visiting the Heart Center body must include cardiology")

    fellowship = page_for("program-sleep-medicine-fellowship")
    fellowship_text = " ".join((normalized_text(fellowship["parser"].title_text), normalized_text(fellowship["parser"].meta["description"][0]), normalized_text(fellowship["parser"].body_text)))
    require(re.search(r"\bsleep\s+medicine\b", fellowship_text, re.I), fellowship["path"], "sleep-medicine fellowship must provide a positive comparator")

    for record_id in ("community-screening", "news-screening-2024", "news-screening-2025", "news-screening-2026"):
        screening = page_for(record_id)
        title = normalized_text(screening["parser"].title_text)
        summary = screening["parser"].meta["description"][0]
        body = normalized_text(screening["parser"].body_text)
        for field, value in (("title", title), ("body", body)):
            require(re.search(r"\bcommunity\s+screening\b", value, re.I), screening["path"], f"{record_id} {field} must contain community screening")
        if record_id in {"news-screening-2024", "news-screening-2025", "news-screening-2026"}:
            require(re.search(r"\bcommunity\s+screening\b", summary, re.I), screening["path"], f"{record_id} summary must contain community screening")
        elif record_id == "community-screening":
            require(re.search(r"\bscreening\b", summary, re.I), screening["path"], "community-screening summary must retain its screening topic")


def check_cardiology_comparison(pages):
    service = pages["/care/services/cardiology/"]
    nursing = pages["/education/nursing/"]
    service_title = normalized_text(service["parser"].title_text)
    nursing_title = normalized_text(nursing["parser"].title_text)
    nursing_description = normalized_text(nursing["parser"].meta["description"])
    nursing_body = normalized_text(nursing["parser"].body_text)

    require(contains_cardiology(service_title), service["path"], "Cardiology service title must contain the whole word cardiology")
    require(contains_cardiology(nursing_body), nursing["path"], "Nursing Studies .search-body must contain the whole word cardiology")
    require(not contains_cardiology(nursing_title), nursing["path"], "Nursing Studies title must not contain cardiology")
    require(not contains_cardiology(nursing_description), nursing["path"], "Nursing Studies description must not contain cardiology")


def load_document_registry(project_root=None, registry_path=None):
    registry_path = Path(registry_path) if registry_path else (project_root or MANIFEST.parents[1]) / "src/data/documents.json"
    records = json.loads(registry_path.read_text(encoding="utf-8"))
    require(isinstance(records, list) and len(records) == 6, registry_path, "expected six document registry records")
    require(all(isinstance(record, dict) for record in records), registry_path, "every registry record must be an object")
    expected = {row["id"]: row for row in _manifest["pdfs"]}
    require({row.get("id") for row in records} == set(expected), registry_path, "document registry IDs must match the approved manifest")
    ids, paths = set(), set()
    for record in records:
        approved = expected[record["id"]]
        require(record.get("title") == approved["title"], registry_path, f"unexpected title for {record['id']}")
        require(record.get("parent_id") == approved["parent_id"], registry_path, f"unexpected parent for {record['id']}")
        require(record.get("source") == approved["future_source_file"], registry_path, f"unexpected source for {record['id']}")
        require(record.get("path") == approved["url_path"], registry_path, f"unexpected path for {record['id']}")
        source = Path(record["source"])
        output = Path(record["path"])
        require(not source.is_absolute() and ".." not in source.parts and source.parts[:3] == ("src", "content", "documents"), registry_path, f"unsafe source path: {source}")
        require(not output.is_absolute() and ".." not in output.parts and output.parts[0] == "pdfs" and output.suffix == ".pdf", registry_path, f"unsafe PDF path: {output}")
        require(record["parent_id"] in HTML_BY_ID, registry_path, f"unknown document parent: {record['parent_id']}")
        require(record["id"] not in ids and record["path"] not in paths, registry_path, "duplicate document ID or output path")
        ids.add(record["id"])
        paths.add(record["path"])
    return records


def scalar_value(frontmatter, key, path):
    match = re.search(rf"^{re.escape(key)}:\s*(.*?)\s*$", frontmatter, re.M)
    require(match is not None, path, f"missing {key} frontmatter")
    value = match.group(1)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value


def strict_boolean_literal(frontmatter, key, expected, path):
    match = re.search(rf"^{re.escape(key)}:\s*(.*?)\s*$", frontmatter, re.M)
    require(match is not None and match.group(1) == str(expected).lower(), path, f"{key} must be an unquoted strict YAML Boolean literal")


def parse_related_ids(frontmatter):
    inline = re.search(r"^related_ids:\s*\[(.*?)\]\s*$", frontmatter, re.M)
    block = re.search(r"^related_ids:\s*\n((?:\s+-\s+[^\n]+\n?)*)", frontmatter, re.M)
    if inline:
        return [part.strip().strip("\"'") for part in inline.group(1).split(",") if part.strip()]
    return re.findall(r"^\s+-\s+([^\n]+)\s*$", block.group(1), re.M) if block else []


def check_source_collection(project_root=None):
    global SOURCE_SUMMARIES
    SOURCE_SUMMARIES = {}
    project_root = Path(project_root or MANIFEST.parents[1])
    page_dir = project_root / "src/content/pages"
    records = [row for row in _manifest["html"] if row["id"] != "home"]
    expected = {row["source_file"] for row in records} | {row["source_file"] for row in _additions}
    actual = {path.relative_to(project_root).as_posix() for path in page_dir.glob("*.md")}
    require(len(actual) == 95 and actual == expected, page_dir, f"expected exactly 95 collection sources; missing={sorted(expected - actual)}, extra={sorted(actual - expected)}")
    for row in records + _additions:
        path = project_root / row["source_file"]
        source = path.read_text(encoding="utf-8")
        require(source.startswith("---\n") and "\n---" in source[4:], path, "missing YAML frontmatter block")
        frontmatter = source[4:source.find("\n---", 4)]
        require(scalar_value(frontmatter, "slug", path) == row["slug"], path, "slug frontmatter must match the approved manifest")
        require(scalar_value(frontmatter, "content_type", path) == row["content_type"], path, "content_type frontmatter must match the approved manifest")
        require(scalar_value(frontmatter, "title", path) == row["title"], path, "title frontmatter must match the approved manifest")
        if row["id"] in ADDED_IDS:
            SOURCE_SUMMARIES[row["id"]] = scalar_value(frontmatter, "summary", path)
            require(bool(SOURCE_SUMMARIES[row["id"]]), path, "source summary must not be empty")
            for key in ("published_date", "updated_date"):
                require(scalar_value(frontmatter, key, path) == row[key], path, f"{key} frontmatter must equal the fixed fixture date")
            for key in ("service_names", "open_for_enrollment"):
                if key in row:
                    if key == "service_names":
                        match = re.search(r"^service_names:\s*\[(.*?)\]\s*$", frontmatter, re.M)
                        require(match is not None, path, "service_names must be a YAML sequence")
                        values = [part.strip().strip("\"'") for part in match.group(1).split(",")]
                        require(values == row[key] and all(values) and len(values) == len(set(values)), path, "service_names must preserve distinct non-empty source values")
                    else:
                        strict_boolean_literal(frontmatter, key, row[key], path)
                else:
                    require(re.search(rf"^{re.escape(key)}:\s*", frontmatter, re.M) is None, path, f"{key} must be absent when not declared")
        else:
            require(not re.search(r"^(?:service_names|open_for_enrollment):\s*", frontmatter, re.M), path, "all original source records must omit D-039 optional fields")
        relation_ids = parse_related_ids(frontmatter)
        known_ids = {item["id"] for item in _manifest["html"]} | ADDED_IDS
        require(set(relation_ids) <= known_ids and len(relation_ids) == len(set(relation_ids)), path, "related_ids must be unique references in the exact 96-record union")
        if row["id"] in ADDED_IDS:
            require(relation_ids == row["related_ids"], path, "related_ids must match the prepared addition edges")
        elif row.get("related_ids") is not None:
            expected_relations = list(row["related_ids"])
            if row["id"] in {"hub-care", "hub-education", "hub-news"}:
                expected_relations.extend(HUB_ADDITIONS[row["id"]])
            require(relation_ids == expected_relations, path, "original related_ids must remain intact with only the authorized additive hub edges")


def check_document_links(pages, records, root):
    for record in records:
        parent = HTML_BY_ID[record["parent_id"]]
        route = "/" + parent["slug"].strip("/") + "/"
        page = pages[route]
        target_url = BASE + record["path"]
        links = [link for link in page["parser"].links if link["href"] == target_url]
        require(len(links) == 1 and normalized_text(links[0]["text"]) == record["title"], page["path"], f"expected one titled PDF link to {target_url} outside .search-body")
        require(not any(in_body and value == target_url for tag, attr, value, in_body in page["parser"].refs), page["path"], "PDF links must be outside .search-body")
        require((root / record["path"]).is_file(), root, f"missing public PDF output: {record['path']}")


def resolve_local_target(root, current_route, value, path, check_fragment=True):
    parts = urlsplit(value)
    require(parts.scheme in ("", "http", "https", "mailto", "tel"), path, f"unsupported URL scheme in {value!r}")
    if parts.scheme in ("mailto", "tel"):
        return None, parts
    if parts.netloc and parts.netloc.lower() != urlsplit(SITE).netloc.lower():
        return None, parts

    current_url = SITE + BASE + current_route.lstrip("/")
    resolved = urlsplit(urljoin(current_url, value))
    raw_path = unquote(resolved.path)
    raw_path = posixpath.normpath("/" + raw_path.lstrip("/"))
    base_path = BASE.rstrip("/")
    require(raw_path == base_path or raw_path.startswith(BASE), path, f"local URL escapes the project base path: {value!r}")
    relative_url_path = raw_path[len(base_path):].lstrip("/") if raw_path.startswith(base_path) else ""
    if not relative_url_path:
        relative_url_path = "index.html"
    target = root / relative_url_path
    if target.is_dir() or relative_url_path.endswith("/"):
        relative_url_path = (Path(relative_url_path) / "index.html").as_posix()
        target = root / relative_url_path
    require(target.is_file(), path, f"local target does not exist: {value!r} -> {target.relative_to(root)}")
    fragment = unquote(resolved.fragment) if check_fragment else ""
    return target, (resolved, fragment)


def check_references(root, page):
    parser = page["parser"]
    path = page["path"]
    route = page["route"]
    for tag, attr, value, in_body in parser.refs:
        if attr == "href" and value.startswith("#"):
            require(unquote(value[1:]) in parser.ids, path, f"anchor target not found: {value!r}")
            continue
        target, result = resolve_local_target(root, route, value, path, check_fragment=(attr == "href"))
        if target is None:
            parts = result
            require(not (parts.scheme == "mailto" or parts.scheme == "tel"), path, f"real contact link is not allowed: {value!r}")
            require(attr != "src", path, f"asset URL must stay under the project base path: {value!r}")
            require(tag != "script" or attr != "src", path, f"external script cannot render static content: {value!r}")
            if attr == "href":
                require(not re.search(r"appointment|schedule|patient-portal|\/portal|contact", parts.path, re.I), path, f"external contact/service link is not allowed: {value!r}")
            continue
        if attr == "src":
            require(target.is_file(), path, f"asset target is not a file: {value!r}")
        elif result[1]:
            target_page = next((p for p in root.rglob("*.html") if p == target), None)
            require(target_page is not None, path, f"fragment target must be an HTML page: {value!r}")
            target_parser = PageParser()
            target_parser.feed(target.read_text(encoding="utf-8"))
            require(result[1] in target_parser.ids, path, f"anchor target not found in {target.relative_to(root)}: #{result[1]}")


def main():
    validate_frozen_manifest()
    check_source_collection()
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "dist").resolve()
    require(root.is_dir(), root, "build output directory does not exist")
    expected_paths = {Path(path) for path in ROUTES.values()}
    actual_paths = {p.relative_to(root) for p in root.rglob("*") if p.is_file() and p.suffix.lower() in {".html", ".htm"}}
    require(len(ROUTES) == 96 and actual_paths == expected_paths, root, f"expected exactly the 96-record HTML union; missing={sorted(map(str, expected_paths - actual_paths))}, extra={sorted(map(str, actual_paths - expected_paths))}")
    actual_pdfs = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".pdf"}
    require(actual_pdfs == set(PDFS), root, f"expected exactly six intended PDFs; missing={sorted(set(PDFS) - actual_pdfs)}, extra={sorted(actual_pdfs - set(PDFS))}")

    pages = {route: inspect_page(root, route, Path(relpath)) for route, relpath in ROUTES.items()}
    check_cardiology_comparison(pages)
    check_remaining_scenario_controls(pages)
    records = load_document_registry()
    canonicals = [page["parser"].meta["canonical"][0] for page in pages.values()]
    require(len(canonicals) == len(set(canonicals)), root, "duplicate canonical URL found")
    for page in pages.values():
        check_references(root, page)
    for hub_id in ("hub-care", "hub-education", "hub-news"):
        hub = HTML_BY_ID[hub_id]
        route = "/" + hub["slug"].strip("/") + "/"
        page = pages[route]
        for added_id in HUB_ADDITIONS[hub_id]:
            row = _added_by_id[added_id]
            target_route = "/" + row["slug"].strip("/") + "/"
            target_url = BASE + row["slug"].strip("/") + "/"
            require(any(link["href"] == target_url for link in page["parser"].links), page["path"], f"hub discovery link missing for addition {row['id']}")
            require(SOURCE_SUMMARIES[row["id"]] in normalized_text(page["parser"].outside_body_text), page["path"], f"hub discovery card summary missing for {row['id']}")
    check_document_links(pages, records, root)

    graph = {route: set() for route in ROUTES}
    for route, page in pages.items():
        for tag, attr, value, in_body in page["parser"].refs:
            if attr != "href":
                continue
            target, _ = resolve_local_target(root, route, value, page["path"], check_fragment=False)
            if target is not None:
                rel = target.relative_to(root)
                target_route = route_for(rel)
                if target_route in pages:
                    graph[route].add(target_route)
    reached = {"/"}
    queue = deque(["/"])
    while queue:
        route = queue.popleft()
        for route in graph[route]:
            if route not in reached:
                reached.add(route)
                queue.append(route)
    require(reached == set(ROUTES), root, f"homepage ordinary-anchor graph reaches {len(reached)}/{len(ROUTES)} routes: {sorted(reached)}")

    print("PASS: exactly 96 union HTML routes (95 collection sources plus home) and six original PDFs")
    print("PASS: language, title, description, canonical, viewport, heading, main, notice, and search-body checks")
    print("PASS: local links, assets, fragments, project base path, titled parent PDF links, and homepage discovery graph")
    print("PASS: original scenario controls, ten script-aligned additions, optional metadata, discovery summaries, and fixed dates")
    print("Metadata candidate names were found in generated HTML only; SearchStax extraction is unverified.")


if __name__ == "__main__":
    try:
        main()
    except (CheckFailure, OSError, UnicodeError, KeyError, TypeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
