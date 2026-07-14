#!/usr/bin/env python3
"""Build the read-only website database from the accepted public graph export."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import unicodedata
from collections import Counter
from pathlib import Path


ROUTE_KINDS = {
    "work": "work",
    "publication": "publication",
    "person": "author",
    "result": "result",
    "claim": "claim",
    "software": "software",
    "source_document": "source",
}
MAX_SLUG_LENGTH = 80


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "object"


def short_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:8]


def route_candidates(objects: list[dict]) -> dict[str, tuple[str, str]]:
    candidates: dict[str, tuple[str, str]] = {}
    counts: Counter[tuple[str, str]] = Counter()

    for obj in objects:
        route_kind = ROUTE_KINDS.get(obj.get("kind"))
        if not route_kind:
            continue
        base = slugify(str(obj.get("label") or obj["id"]))
        truncated = len(base) > MAX_SLUG_LENGTH
        if truncated:
            base = f"{base[: MAX_SLUG_LENGTH - 9].rstrip('-')}-{short_hash(obj['id'])}"
        candidates[obj["id"]] = (route_kind, base)
        counts[(route_kind, base)] += 1

    routes: dict[str, tuple[str, str]] = {}
    for object_id, (route_kind, base) in candidates.items():
        slug = base
        if counts[(route_kind, base)] > 1:
            suffix = short_hash(object_id)
            slug = f"{base[: MAX_SLUG_LENGTH - 9].rstrip('-')}-{suffix}"
        routes[object_id] = (route_kind, slug)
    return routes


def json_text(value: object) -> str:
    return json.dumps(value or {}, separators=(",", ":"), ensure_ascii=False)


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE objects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  properties TEXT NOT NULL
);

CREATE TABLE identifiers (
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (object_id, namespace, value)
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES objects(id),
  target_id TEXT NOT NULL REFERENCES objects(id),
  statement TEXT NOT NULL,
  properties TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  locator TEXT NOT NULL,
  properties TEXT NOT NULL
);

CREATE TABLE evidence (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  literal TEXT NOT NULL,
  properties TEXT NOT NULL,
  PRIMARY KEY (connection_id, position)
);

CREATE TABLE routes (
  path TEXT PRIMARY KEY,
  route_kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  object_id TEXT NOT NULL UNIQUE REFERENCES objects(id) ON DELETE CASCADE
);

CREATE INDEX objects_kind_idx ON objects(kind);
CREATE INDEX identifiers_lookup_idx ON identifiers(namespace, value);
CREATE INDEX connections_source_idx ON connections(source_id);
CREATE INDEX connections_target_idx ON connections(target_id);
CREATE INDEX evidence_connection_idx ON evidence(connection_id);
CREATE INDEX routes_object_idx ON routes(object_id);

CREATE VIRTUAL TABLE search_fts USING fts5(
  object_id UNINDEXED,
  kind UNINDEXED,
  label,
  description
);
"""


def build(source_path: Path, output_path: Path) -> None:
    graph = json.loads(source_path.read_text())
    objects = graph.get("objects", [])
    routes = route_candidates(objects)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
    temporary_path.unlink(missing_ok=True)

    connection = sqlite3.connect(temporary_path)
    try:
        connection.executescript(SCHEMA)
        connection.execute(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            ("schema_version", "site-index-v1"),
        )
        connection.execute(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            ("source_schema_version", str(graph.get("schema_version", ""))),
        )

        for obj in objects:
            properties = obj.get("properties") or {}
            public_properties = {}
            if obj["kind"] == "work" and properties.get("slug"):
                public_properties["slug"] = properties["slug"]
            connection.execute(
                "INSERT INTO objects VALUES (?, ?, ?, ?, ?)",
                (
                    obj["id"],
                    obj["kind"],
                    str(obj.get("label") or ""),
                    ""
                    if obj["kind"] == "source_document"
                    else str(obj.get("description") or ""),
                    json_text(public_properties),
                ),
            )
            for identifier in properties.get("identifiers", []):
                namespace = str(identifier.get("namespace") or "")
                value = str(identifier.get("value") or "")
                if namespace and namespace != "local" and value:
                    connection.execute(
                        "INSERT OR IGNORE INTO identifiers VALUES (?, ?, ?)",
                        (obj["id"], namespace, value),
                    )
            if obj["id"] in routes:
                route_kind, slug = routes[obj["id"]]
                connection.execute(
                    "INSERT INTO routes VALUES (?, ?, ?, ?)",
                    (f"/{route_kind}/{slug}", route_kind, slug, obj["id"]),
                )
            connection.execute(
                "INSERT INTO search_fts VALUES (?, ?, ?, ?)",
                (
                    obj["id"],
                    obj["kind"],
                    str(obj.get("label") or ""),
                    str(obj.get("description") or ""),
                ),
            )

        for source in graph.get("sources", []):
            connection.execute(
                "INSERT INTO sources VALUES (?, ?, ?, ?, ?)",
                (
                    source["id"],
                    str(source.get("kind") or ""),
                    str(source.get("label") or ""),
                    "",
                    json_text(
                        {
                            "document_id": source.get("properties", {}).get(
                                "document_id"
                            )
                        }
                        if source.get("properties", {}).get("document_id")
                        else {}
                    ),
                ),
            )

        for edge in graph.get("connections", []):
            connection.execute(
                "INSERT INTO connections VALUES (?, ?, ?, ?, ?)",
                (
                    edge["id"],
                    edge["source"],
                    edge["target"],
                    str(edge.get("statement") or ""),
                    "{}",
                ),
            )
            for position, item in enumerate(edge.get("evidence") or []):
                connection.execute(
                    "INSERT INTO evidence VALUES (?, ?, ?, ?, ?)",
                    (
                        edge["id"],
                        position,
                        str(item.get("source") or ""),
                        str(item.get("span") or ""),
                        json_text(
                            {
                                "document_id": item.get("properties", {}).get(
                                    "document_id"
                                )
                            }
                            if item.get("properties", {}).get("document_id")
                            else {}
                        ),
                    ),
                )

        connection.commit()
        connection.execute("PRAGMA optimize")
        connection.commit()
    finally:
        connection.close()

    temporary_path.replace(output_path)
    print(
        f"Built {output_path} with {len(objects)} objects, "
        f"{len(graph.get('connections', []))} connections, and {len(routes)} routes."
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("db/resource-index.json"))
    parser.add_argument("--output", type=Path, default=Path("build/site-index.sqlite"))
    args = parser.parse_args()
    build(args.source, args.output)


if __name__ == "__main__":
    main()
