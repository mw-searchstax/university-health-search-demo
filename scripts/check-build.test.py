"""Regression checks for the output validator's path and HTML parsing."""

from pathlib import Path
import runpy
import json
import tempfile
import unittest


checks = runpy.run_path(str(Path(__file__).with_name("check-build.py")))


class BuildCheckerTests(unittest.TestCase):
    def test_manifest_freezes_86_routes_and_six_documents(self):
        self.assertEqual(len(checks["_manifest"]["html"]), 86)
        self.assertEqual(len(checks["ROUTES"]), 96)
        self.assertEqual(checks["SEARCH_ROUTE"], "/search/")
        self.assertNotIn(checks["SEARCH_ROUTE"], checks["ROUTES"])
        self.assertEqual(len(checks["PDFS"]), 6)
        self.assertEqual(checks["ROUTES"]["/"], "index.html")
        checks["validate_frozen_manifest"]()

    def test_site_search_requires_get_action_query_name_and_accessible_label(self):
        parser = checks["PageParser"]()
        parser.feed('<form role="search" action="/university-health-search-demo/search/" method="get"><label>Search<input type="search" name="q"></label><button>Search</button></form>')
        checks["check_site_search"](parser, "page.html")

        cases = [
            ('<form action="/university-health-search-demo/search/" method="post"><input type="search" name="q" aria-label="Search"></form>', "GET"),
            ('<form action="/wrong/" method="get"><input type="search" name="q" aria-label="Search"></form>', "GET to /search/"),
            ('<form action="/university-health-search-demo/search/" method="get"><input type="search" name="query" aria-label="Search"></form>', "name=q"),
            ('<form action="/university-health-search-demo/search/" method="get"><input type="search" name="q"></form>', "accessible label"),
        ]
        for markup, message in cases:
            with self.subTest(message=message):
                bad = checks["PageParser"]()
                bad.feed(markup)
                with self.assertRaisesRegex(checks["CheckFailure"], message):
                    checks["check_site_search"](bad, "page.html")

    def test_search_utility_route_has_shared_shell_search_heading_and_notice(self):
        html = f'''<html lang="en"><head><title>Search | Alder Coast</title>
        <meta name="description" content="Search the fictional site."><meta name="viewport" content="width=device-width">
        <link rel="canonical" href="{checks["SITE"]}{checks["BASE"]}search/"></head><body>
        <form action="{checks["BASE"]}search/" method="get"><label>Search<input type="search" name="q"></label></form>
        <main><h1>Search the website</h1><p>{checks["NOTICE"]}</p><div id="results-widget"></div></main><script src="/search.js"></script></body></html>'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "search/index.html"
            path.parent.mkdir()
            path.write_text(html)
            page = checks["inspect_page"](Path(directory), checks["SEARCH_ROUTE"], Path("search/index.html"))
            self.assertEqual(page["route"], "/search/")

    def test_script_projection_rejects_missing_addition_and_date_drift(self):
        globals_ = checks["validate_frozen_manifest"].__globals__
        additions = globals_["_additions"]
        original_dates = dict(globals_["ADDED_DATES"])
        try:
            removed = additions.pop()
            with self.assertRaisesRegex(checks["CheckFailure"], "exact ten approved addition IDs"):
                checks["validate_frozen_manifest"]()
            additions.append(removed)
            globals_["ADDED_DATES"]["news-flu-clinics-2025"] = ("2025-09-16", "2025-09-15")
            with self.assertRaisesRegex(checks["CheckFailure"], "fixed D-039 dates"):
                checks["validate_frozen_manifest"]()
        finally:
            if len(additions) < 10:
                additions.append(removed)
            globals_["ADDED_DATES"].clear()
            globals_["ADDED_DATES"].update(original_dates)

    def test_script_projection_rejects_allowed_but_wrong_content_type(self):
        globals_ = checks["validate_frozen_manifest"].__globals__
        additions = globals_["_additions"]
        row = next(item for item in additions if item["id"] == "program-business-administration")
        original_type = row["content_type"]
        try:
            row["content_type"] = "service"
            with self.assertRaisesRegex(checks["CheckFailure"], "match its frozen ID prefix"):
                checks["validate_frozen_manifest"]()
        finally:
            row["content_type"] = original_type

    def test_optional_metadata_requires_explicit_false_and_absence(self):
        parser = checks["PageParser"]()
        parser.feed('<meta name="demo-open-for-enrollment" content="false">')
        row = checks["_added_by_id"]["program-nursing-community-practice"]
        checks["check_optional_metadata"](parser, row, "Closed (fictional)", "community-practice.html")
        parser.meta["demo-open-for-enrollment"] = []
        with self.assertRaisesRegex(checks["CheckFailure"], "exact lowercase Boolean"):
            checks["check_optional_metadata"](parser, row, "Closed (fictional)", "community-practice.html")
        old = checks["HTML_BY_ID"]["program-nursing"]
        parser.meta["demo-open-for-enrollment"] = ["false"]
        with self.assertRaisesRegex(checks["CheckFailure"], "absent from every original page"):
            checks["check_optional_metadata"](parser, old, "", "nursing.html")

    def test_source_boolean_rejects_quoted_false_and_relationship_yaml_forms(self):
        literal = checks["strict_boolean_literal"]
        literal("open_for_enrollment: false", "open_for_enrollment", False, "course.md")
        with self.assertRaisesRegex(checks["CheckFailure"], "unquoted strict YAML Boolean"):
            literal('open_for_enrollment: "false"', "open_for_enrollment", False, "course.md")
        parse = checks["parse_related_ids"]
        expected = ["hub-care", "resource-flu-shot-appointments"]
        self.assertEqual(parse("related_ids: [hub-care, resource-flu-shot-appointments]"), expected)
        self.assertEqual(parse("related_ids:\n  - hub-care\n  - resource-flu-shot-appointments"), expected)

    def test_lexical_controls_reject_mba_leak_and_plural_title_drift(self):
        guard = checks["check_script_lexical_controls"]
        with self.assertRaisesRegex(checks["CheckFailure"], "exclude the MBA"):
            guard("program-business-administration", "Master of Business Administration", "An MBA curriculum", "Case work", "business.html")
        with self.assertRaisesRegex(checks["CheckFailure"], "exact plural flu shots"):
            guard("resource-flu-shot-appointments", "Flu Shot Information", "A fictional notice", "Flu shots details", "flu.html")

    def test_international_health_excludes_each_search_word_individually(self):
        guard = checks["check_script_lexical_controls"]
        for leaking_word in ("travel", "vaccinations"):
            with self.subTest(leaking_word=leaking_word), self.assertRaisesRegex(checks["CheckFailure"], "exclude travel and vaccinations"):
                guard("service-international-health", "International Health", "A neutral summary", f"Reference notes include {leaking_word}.", "international-health.html")

    def test_manifest_source_inventory_matches_85_frontmatter_records(self):
        checks["check_source_collection"]()

    @staticmethod
    def comparison_pages(service_title="Cardiology | Alder Coast", nursing_title="Nursing Studies | Alder Coast",
                         nursing_description="An overview of the nursing program.",
                         nursing_body="Nursing learners study cardiology vocabulary."):
        def page(title, description, body, path):
            parser = checks["PageParser"]()
            parser.feed(f"<html><head><title>{title}</title><meta name='description' content='{description}'></head><body><div class='search-body'>{body}</div></body></html>")
            return {"path": Path(path), "parser": parser}

        return {
            "/care/services/cardiology/": page(service_title, "A service overview.", "Cardiology department details.", "service.html"),
            "/education/nursing/": page(nursing_title, nursing_description, nursing_body, "nursing.html"),
        }

    def test_directory_targets_and_project_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "care").mkdir()
            target = root / "care/index.html"
            target.write_text("<main id='main-content'>Care</main>")
            resolve = checks["resolve_local_target"]
            resolved, _ = resolve(root, "/", checks["BASE"] + "care/", root)
            self.assertEqual(resolved, target)
            for url in ("/care/", checks["BASE"] + "missing/", checks["BASE"] + "../other/"):
                with self.subTest(url=url), self.assertRaises(checks["CheckFailure"]):
                    resolve(root, "/", url, root)

    def test_void_tags_do_not_leak_facts_into_search_body(self):
        parser = checks["PageParser"]()
        parser.feed('<html lang="en"><head><meta name="description" content="A lead"><link rel="stylesheet" href="style.css"></head><body><main><div class="search-body"><p class="lead">A lead</p><p>Payload</p></div><aside>Sleep Medicine</aside></main></body></html>')
        self.assertEqual(checks["normalized_text"](parser.body_text), "A lead Payload")
        self.assertIn("Sleep Medicine", checks["normalized_text"](parser.outside_body_text))
        self.assertTrue(parser.search_body_inside_main)

    def test_cardiology_comparison_accepts_case_insensitive_whole_word_matches(self):
        pages = self.comparison_pages(
            service_title="CARDIOLOGY | Alder Coast",
            nursing_body="Nursing learners study Cardiology vocabulary, unlike noncardiology labels.",
        )
        self.assertFalse(checks["contains_cardiology"]("noncardiology cardiologies"))
        checks["check_cardiology_comparison"](pages)

    def test_cardiology_comparison_rejects_missing_service_title_match(self):
        pages = self.comparison_pages(service_title="Precardiology | Alder Coast")
        with self.assertRaisesRegex(checks["CheckFailure"], "service title"):
            checks["check_cardiology_comparison"](pages)

    def test_cardiology_comparison_rejects_missing_nursing_body_match(self):
        pages = self.comparison_pages(nursing_body="Nursing learners study noncardiology labels.")
        with self.assertRaisesRegex(checks["CheckFailure"], "search-body"):
            checks["check_cardiology_comparison"](pages)

    def test_cardiology_comparison_rejects_nursing_title_contamination(self):
        pages = self.comparison_pages(nursing_title="Cardiology for Nursing | Alder Coast")
        with self.assertRaisesRegex(checks["CheckFailure"], "title must not"):
            checks["check_cardiology_comparison"](pages)

    def test_cardiology_comparison_rejects_nursing_description_contamination(self):
        pages = self.comparison_pages(nursing_description="A nursing cardiology program overview.")
        with self.assertRaisesRegex(checks["CheckFailure"], "description must not"):
            checks["check_cardiology_comparison"](pages)

    def test_document_registry_rejects_missing_record_and_broken_parent(self):
        records = json.loads(checks["DOCUMENT_REGISTRY"].read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "documents.json"
            path.write_text(json.dumps(records[:-1]))
            with self.assertRaisesRegex(checks["CheckFailure"], "six document"):
                checks["load_document_registry"](registry_path=path)
            records[0]["parent_id"] = "orphaned-parent"
            path.write_text(json.dumps(records))
            with self.assertRaisesRegex(checks["CheckFailure"], "unexpected parent"):
                checks["load_document_registry"](registry_path=path)

    def test_parent_document_link_must_be_titled_unique_and_outside_body(self):
        record = json.loads(checks["DOCUMENT_REGISTRY"].read_text(encoding="utf-8"))[0]
        parent = checks["HTML_BY_ID"][record["parent_id"]]
        route = "/" + parent["slug"] + "/"
        pdf = record["path"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / pdf).parent.mkdir(parents=True)
            (root / pdf).write_bytes(b"pdf")
            parser = checks["PageParser"]()
            parser.feed(f'<main><a href="{checks["BASE"]}{pdf}">{record["title"]}</a></main>')
            page = {"path": root / "parent.html", "parser": parser}
            checks["check_document_links"]({route: page}, [record], root)
            parser2 = checks["PageParser"]()
            parser2.feed(f'<main><div class="search-body"><a href="{checks["BASE"]}{pdf}">{record["title"]}</a></div></main>')
            with self.assertRaisesRegex(checks["CheckFailure"], "outside .search-body"):
                checks["check_document_links"]({route: {"path": page["path"], "parser": parser2}}, [record], root)

    def test_remaining_scenario_controls_detect_contaminated_comparators(self):
        def page(record_id, title, summary, body):
            record = checks["HTML_BY_ID"][record_id]
            route = "/" + record["slug"] + "/"
            parser = checks["PageParser"]()
            parser.feed(f"<html><head><title>{title}</title><meta name='description' content='{summary}'></head><body><main><div class='search-body'>{body}</div></main></body></html>")
            return route, {"path": Path(record["source_file"]), "parser": parser}

        rows = [
            page("resource-heart-education", "Heart Attack Education", "Neutral vocabulary about heart attack terms.", "A heart attack is the everyday term discussed here."),
            page("provider-jonah-fenwick", "Jonah Fenwick", "A cardiology atlas collection.", "Cardiology vocabulary appears in the annotated collection."),
            page("resource-cardiology-visit", "Visiting the Heart Center", "A cardiology gallery overview.", "The cardiology collection groups teaching exhibits."),
            page("program-sleep-medicine-fellowship", "Sleep Medicine Fellowship", "An academic sequence.", "Learners compare sleep medicine subject labels."),
            page("community-screening", "Community Screening Information", "An enduring public-education program explaining screening vocabulary and sample materials.", "The community screening collection includes reference cards."),
            page("news-screening-2024", "Community Screening Archive 2024", "Community screening catalogue archive.", "The community screening archive records a library change."),
            page("news-screening-2025", "Community Screening Update 2025", "Community screening catalogue update.", "The community screening catalogue was reorganized."),
            page("news-screening-2026", "Community Screening Update 2026", "Community screening reading collection.", "The community screening index includes a current shelf map."),
        ]
        pages = dict(rows)
        checks["check_remaining_scenario_controls"](pages)
        route, contaminated = page("provider-jonah-fenwick", "Cardiology with Jonah Fenwick", "A cardiology atlas collection.", "Cardiology vocabulary appears.")
        pages[route] = contaminated
        with self.assertRaisesRegex(checks["CheckFailure"], "title must exclude cardiology"):
            checks["check_remaining_scenario_controls"](pages)

    def test_scenario_guards_reject_missing_heart_summary_visit_body_and_screening_fields(self):
        def page(record_id, title, summary, body):
            record = checks["HTML_BY_ID"][record_id]
            route = "/" + record["slug"] + "/"
            parser = checks["PageParser"]()
            parser.feed(f"<html><head><title>{title}</title><meta name='description' content='{summary}'></head><body><main><div class='search-body'>{body}</div></main></body></html>")
            return route, {"path": Path(record["source_file"]), "parser": parser}

        rows = [
            page("resource-heart-education", "Heart Attack Education", "Everyday heart attack terminology.", "A heart attack is the phrase used in this teaching card."),
            page("provider-jonah-fenwick", "Jonah Fenwick", "A cardiology atlas collection.", "Cardiology vocabulary appears in the annotated collection."),
            page("resource-cardiology-visit", "Visiting the Heart Center", "A cardiology gallery overview.", "The cardiology collection groups teaching exhibits."),
            page("program-sleep-medicine-fellowship", "Sleep Medicine Fellowship", "An academic sequence.", "Learners compare sleep medicine subject labels."),
            page("community-screening", "Community Screening Information", "An enduring public-education program explaining screening vocabulary and sample materials.", "The community screening collection includes reference cards."),
            page("news-screening-2024", "Community Screening Archive 2024", "Community screening catalogue archive.", "The community screening archive records a library change."),
            page("news-screening-2025", "Community Screening Update 2025", "Community screening catalogue update.", "The community screening catalogue was reorganized."),
            page("news-screening-2026", "Community Screening Update 2026", "Community screening reading collection.", "The community screening index includes a shelf map."),
        ]
        pages = dict(rows)
        route, bad_heart = page("resource-heart-education", "Heart Attack Education", "Terminology card.", "A heart attack is the phrase used in this teaching card.")
        pages[route] = bad_heart
        with self.assertRaisesRegex(checks["CheckFailure"], "summary must preserve"):
            checks["check_remaining_scenario_controls"](pages)
        pages = dict(rows)
        route, bad_jonah = page("provider-jonah-fenwick", "Jonah Fenwick", "An atlas collection.", "The annotated collection is used in class.")
        pages[route] = bad_jonah
        with self.assertRaisesRegex(checks["CheckFailure"], "body must include cardiology"):
            checks["check_remaining_scenario_controls"](pages)
        pages = dict(rows)
        route, bad_visit = page("resource-cardiology-visit", "Visiting the Heart Center", "A cardiology gallery overview.", "The gallery groups teaching exhibits.")
        pages[route] = bad_visit
        with self.assertRaisesRegex(checks["CheckFailure"], "body must include cardiology"):
            checks["check_remaining_scenario_controls"](pages)
        pages = dict(rows)
        route, bad_date = page("news-screening-2025", "Community Screening Update 2025", "An archive catalogue update.", "The community screening catalogue was reorganized.")
        pages[route] = bad_date
        with self.assertRaisesRegex(checks["CheckFailure"], "summary must contain community screening"):
            checks["check_remaining_scenario_controls"](pages)
        pages = dict(rows)
        route, bad_program_summary = page("community-screening", "Community Screening Information", "Community information about materials.", "The community screening collection includes reference cards.")
        pages[route] = bad_program_summary
        with self.assertRaisesRegex(checks["CheckFailure"], "retain its screening topic"):
            checks["check_remaining_scenario_controls"](pages)


if __name__ == "__main__":
    unittest.main()
