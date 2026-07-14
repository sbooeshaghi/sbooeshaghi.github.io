from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_builder():
    path = ROOT / "scripts" / "build-site-db.py"
    spec = importlib.util.spec_from_file_location("build_site_db", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


class SiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.temporary.name)
        cls.site = cls.directory / "site"
        cls.site.mkdir()
        (cls.site / "index.html").write_text("home")
        (cls.site / "object.html").write_text("object shell")
        (cls.site / "works").mkdir()
        (cls.site / "works" / "test.html").write_text("rich work page")
        (cls.site / "db").mkdir()
        (cls.site / "db" / "publications.json").write_text('{"works": []}')

        graph = {
            "schema_version": "resource-index-v0",
            "objects": [
                {
                    "id": "work:test",
                    "kind": "work",
                    "label": "A Test Work",
                    "description": "A compact description.",
                    "properties": {"identifiers": [{"namespace": "local", "value": "work:test"}]},
                },
                {
                    "id": "person:test",
                    "kind": "person",
                    "label": "Test Author",
                    "description": "Test Author",
                    "properties": {
                        "identifiers": [
                            {"namespace": "orcid", "value": "https://orcid.org/0000-0000-0000-0001"}
                        ]
                    },
                },
                {
                    "id": "claim:test",
                    "kind": "claim",
                    "label": "The test has a grounded claim.",
                    "description": "The test has a grounded claim.",
                    "properties": {"identifiers": [{"namespace": "local", "value": "claim:test"}]},
                },
                {
                    "id": "document:test",
                    "kind": "source_document",
                    "label": "test-source.pdf",
                    "description": "/private/source/path.txt",
                    "properties": {"identifiers": [{"namespace": "local", "value": "document:test"}]},
                },
            ],
            "connections": [
                {
                    "id": "connection:author",
                    "source": "work:test",
                    "target": "person:test",
                    "statement": "Test Author wrote A Test Work.",
                    "evidence": [],
                    "properties": {},
                },
                {
                    "id": "connection:claim",
                    "source": "work:test",
                    "target": "claim:test",
                    "statement": "A Test Work makes this claim.",
                    "evidence": [
                        {
                            "source": "source:text:document:test",
                            "span": "This exact sentence supports the claim.",
                            "properties": {"document_id": "document:test"},
                        }
                    ],
                    "properties": {},
                },
            ],
            "sources": [
                {
                    "id": "source:text:document:test",
                    "kind": "text",
                    "label": "private-source.txt",
                    "locator": "/private/source/path.txt",
                    "properties": {"document_id": "document:test"},
                }
            ],
        }
        source = cls.directory / "graph.json"
        source.write_text(json.dumps(graph))
        database = cls.directory / "site.sqlite"
        load_builder().build(source, database)
        with sqlite3.connect(database) as built:
            cls.database_text = " ".join(
                str(value)
                for table, column in [
                    ("objects", "description"),
                    ("objects", "properties"),
                    ("identifiers", "value"),
                    ("sources", "locator"),
                    ("sources", "properties"),
                    ("connections", "properties"),
                    ("evidence", "properties"),
                ]
                for (value,) in built.execute(f"SELECT {column} FROM {table}")
            )

        os.environ["SITE_ROOT"] = str(cls.site)
        os.environ["SITE_DATABASE"] = str(database)
        sys.path.insert(0, str(ROOT))
        from backend.app import create_app

        cls.app = create_app()
        cls.app.config.update(TESTING=True)
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_health(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"status": "ok"})

    def test_object_route_and_public_projection(self):
        response = self.client.get("/api/objects/work/a-test-work")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["object"]["label"], "A Test Work")
        self.assertEqual(response.json["relation_counts"], {"claim": 1, "person": 1})
        self.assertNotIn("work:test", json.dumps(response.json))

    def test_relation_evidence_links_to_source_object(self):
        response = self.client.get(
            "/api/objects/work/a-test-work/relations?kind=claim"
        )
        self.assertEqual(response.status_code, 200)
        evidence = response.json["items"][0]["evidence"][0]
        self.assertEqual(evidence["span"], "This exact sentence supports the claim.")
        self.assertEqual(evidence["source"]["label"], "test-source.pdf")
        self.assertEqual(evidence["source"]["path"], "/source/test-source-pdf")
        self.assertNotIn("/private/", json.dumps(response.json))

    def test_search(self):
        response = self.client.get("/api/search?q=grounded+claim")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["items"][0]["kind"], "claim")

    def test_legacy_object_route_redirects(self):
        response = self.client.get("/object.html?id=person:test")
        self.assertEqual(response.status_code, 308)
        self.assertEqual(response.headers["Location"], "/author/test-author")

    def test_clean_route_serves_object_shell(self):
        response = self.client.get("/author/test-author")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "object shell")
        response.close()

    def test_clean_work_route_preserves_rich_work_page(self):
        response = self.client.get("/work/a-test-work")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "rich work page")
        response.close()

    def test_two_segment_static_asset_is_not_treated_as_object_route(self):
        response = self.client.get("/db/publications.json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"works": []})
        response.close()

    def test_deployable_database_omits_local_paths_and_identifiers(self):
        self.assertNotIn("/private/", self.database_text)
        self.assertNotIn("work:test", self.database_text)


if __name__ == "__main__":
    unittest.main()
