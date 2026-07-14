"""Read-only HTTP application for sina.bio."""

from __future__ import annotations

import json
import os
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_from_directory


ROOT = Path(os.environ.get("SITE_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATABASE = Path(os.environ.get("SITE_DATABASE", ROOT / "build" / "site-index.sqlite")).resolve()
PUBLIC_KINDS = {
    "work",
    "publication",
    "person",
    "result",
    "claim",
    "software",
    "source_document",
}
ROUTE_KIND_TO_OBJECT_KIND = {
    "work": "work",
    "publication": "publication",
    "author": "person",
    "result": "result",
    "claim": "claim",
    "software": "software",
    "source": "source_document",
}
KIND_ORDER = {
    kind: position
    for position, kind in enumerate(
        ["work", "publication", "person", "result", "claim", "software", "source_document"]
    )
}


def connect() -> sqlite3.Connection:
    if not DATABASE.is_file():
        raise RuntimeError(f"Website database not found: {DATABASE}")
    database = sqlite3.connect(f"file:{DATABASE}?mode=ro&immutable=1", uri=True)
    database.row_factory = sqlite3.Row
    return database


def public_description(kind: str, label: str, description: str) -> str:
    if kind == "source_document":
        return "Source document retained for grounded evidence."
    return "" if description.strip() == label.strip() else description.strip()


def identifiers_for(database: sqlite3.Connection, object_ids: list[str]) -> dict[str, list[dict]]:
    if not object_ids:
        return {}
    placeholders = ",".join("?" for _ in object_ids)
    rows = database.execute(
        f"""
        SELECT object_id, namespace, value
        FROM identifiers
        WHERE object_id IN ({placeholders}) AND namespace != 'local'
        ORDER BY namespace, value
        """,
        object_ids,
    ).fetchall()
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row["object_id"]].append(
            {"namespace": row["namespace"], "value": row["value"]}
        )
    return grouped


def object_payload(row: sqlite3.Row, identifiers: list[dict] | None = None) -> dict:
    return {
        "kind": row["kind"],
        "label": row["label"],
        "description": public_description(row["kind"], row["label"], row["description"]),
        "identifiers": identifiers or [],
        "path": row["path"],
    }


def route_row(database: sqlite3.Connection, route_kind: str, slug: str) -> sqlite3.Row | None:
    return database.execute(
        """
        SELECT o.id, o.kind, o.label, o.description, o.properties, r.path
        FROM routes r JOIN objects o ON o.id = r.object_id
        WHERE r.route_kind = ? AND r.slug = ?
        """,
        (route_kind, slug),
    ).fetchone()


def relation_counts(database: sqlite3.Connection, object_id: str) -> dict[str, int]:
    rows = database.execute(
        """
        SELECT neighbor.kind, COUNT(*) AS count
        FROM connections edge
        JOIN objects neighbor ON neighbor.id = CASE
          WHEN edge.source_id = ? THEN edge.target_id
          ELSE edge.source_id
        END
        WHERE edge.source_id = ? OR edge.target_id = ?
        GROUP BY neighbor.kind
        """,
        (object_id, object_id, object_id),
    ).fetchall()
    return {row["kind"]: row["count"] for row in rows if row["kind"] in PUBLIC_KINDS}


def evidence_for(database: sqlite3.Connection, connection_ids: list[str]) -> dict[str, list[dict]]:
    if not connection_ids:
        return {}
    placeholders = ",".join("?" for _ in connection_ids)
    rows = database.execute(
        f"""
        SELECT
          evidence.connection_id,
          evidence.position,
          evidence.literal,
          evidence.source_id,
          evidence.properties AS evidence_properties,
          sources.label AS source_label,
          sources.properties AS source_properties
        FROM evidence
        LEFT JOIN sources ON sources.id = evidence.source_id
        WHERE evidence.connection_id IN ({placeholders})
        ORDER BY evidence.connection_id, evidence.position
        """,
        connection_ids,
    ).fetchall()

    document_ids: set[str] = set()
    prepared = []
    for row in rows:
        evidence_properties = json.loads(row["evidence_properties"] or "{}")
        source_properties = json.loads(row["source_properties"] or "{}")
        document_id = evidence_properties.get("document_id") or source_properties.get("document_id")
        if document_id:
            document_ids.add(document_id)
        prepared.append((row, document_id))

    source_routes = {}
    if document_ids:
        placeholders = ",".join("?" for _ in document_ids)
        route_rows = database.execute(
            f"""
            SELECT routes.object_id, routes.path, objects.label
            FROM routes JOIN objects ON objects.id = routes.object_id
            WHERE routes.object_id IN ({placeholders})
            """,
            sorted(document_ids),
        ).fetchall()
        source_routes = {
            row["object_id"]: {"label": row["label"], "path": row["path"]}
            for row in route_rows
        }

    grouped: dict[str, list[dict]] = defaultdict(list)
    for row, document_id in prepared:
        source = source_routes.get(document_id)
        if not source and row["source_label"]:
            source = {"label": row["source_label"], "path": ""}
        grouped[row["connection_id"]].append(
            {"span": row["literal"], "source": source}
        )
    return grouped


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)

    @app.get("/healthz")
    def health() -> tuple[dict, int]:
        try:
            with connect() as database:
                database.execute("SELECT 1").fetchone()
            return {"status": "ok"}, 200
        except (RuntimeError, sqlite3.Error):
            return {"status": "unavailable"}, 503

    @app.get("/api/stats")
    def stats():
        with connect() as database:
            kinds = {
                row["kind"]: row["count"]
                for row in database.execute(
                    "SELECT kind, COUNT(*) AS count FROM objects GROUP BY kind"
                )
            }
            connections = database.execute("SELECT COUNT(*) FROM connections").fetchone()[0]
        return jsonify({"objects": kinds, "connections": connections})

    @app.get("/api/search")
    def search():
        query = request.args.get("q", "").strip()
        if not query:
            return jsonify({"items": []})
        requested_kind = request.args.get("kind", "").strip()
        object_kind = ROUTE_KIND_TO_OBJECT_KIND.get(requested_kind, requested_kind)
        if object_kind and object_kind not in PUBLIC_KINDS:
            abort(400, description="Unknown object kind.")
        limit = min(max(request.args.get("limit", 20, type=int), 1), 50)
        tokens = re.findall(r"[\w]+", query, flags=re.UNICODE)
        if not tokens:
            return jsonify({"items": []})
        match_query = " AND ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in tokens)

        sql = """
            SELECT o.id, o.kind, o.label, o.description, r.path, bm25(search_fts) AS score
            FROM search_fts
            JOIN objects o ON o.id = search_fts.object_id
            JOIN routes r ON r.object_id = o.id
            WHERE search_fts MATCH ?
        """
        parameters: list[object] = [match_query]
        if object_kind:
            sql += " AND o.kind = ?"
            parameters.append(object_kind)
        sql += " ORDER BY score, o.label LIMIT ?"
        parameters.append(limit)

        with connect() as database:
            rows = database.execute(sql, parameters).fetchall()
            identifiers = identifiers_for(database, [row["id"] for row in rows])
            items = [object_payload(row, identifiers.get(row["id"])) for row in rows]
        return jsonify({"items": items})

    @app.get("/api/objects/<route_kind>/<slug>")
    def fetch_object(route_kind: str, slug: str):
        if route_kind not in ROUTE_KIND_TO_OBJECT_KIND:
            abort(404)
        with connect() as database:
            row = route_row(database, route_kind, slug)
            if not row:
                abort(404)
            identifiers = identifiers_for(database, [row["id"]]).get(row["id"], [])
            counts = relation_counts(database, row["id"])
        return jsonify({"object": object_payload(row, identifiers), "relation_counts": counts})

    @app.get("/api/objects/<route_kind>/<slug>/relations")
    def fetch_relations(route_kind: str, slug: str):
        if route_kind not in ROUTE_KIND_TO_OBJECT_KIND:
            abort(404)
        requested_kind = request.args.get("kind", "").strip()
        if requested_kind and requested_kind not in PUBLIC_KINDS:
            abort(400, description="Unknown relation kind.")
        limit = min(max(request.args.get("limit", 100, type=int), 1), 200)
        offset = max(request.args.get("offset", 0, type=int), 0)

        with connect() as database:
            selected = route_row(database, route_kind, slug)
            if not selected:
                abort(404)
            parameters: list[object] = [selected["id"], selected["id"], selected["id"]]
            kind_filter = ""
            if requested_kind:
                kind_filter = " AND neighbor.kind = ?"
                parameters.append(requested_kind)
            count = database.execute(
                f"""
                SELECT COUNT(*)
                FROM connections edge
                JOIN objects neighbor ON neighbor.id = CASE
                  WHEN edge.source_id = ? THEN edge.target_id
                  ELSE edge.source_id
                END
                WHERE (edge.source_id = ? OR edge.target_id = ?){kind_filter}
                """,
                parameters,
            ).fetchone()[0]

            parameters.extend([limit, offset])
            rows = database.execute(
                f"""
                SELECT
                  edge.id AS connection_id,
                  edge.source_id,
                  edge.target_id,
                  edge.statement,
                  neighbor.id,
                  neighbor.kind,
                  neighbor.label,
                  neighbor.description,
                  routes.path
                FROM connections edge
                JOIN objects neighbor ON neighbor.id = CASE
                  WHEN edge.source_id = ? THEN edge.target_id
                  ELSE edge.source_id
                END
                JOIN routes ON routes.object_id = neighbor.id
                WHERE (edge.source_id = ? OR edge.target_id = ?){kind_filter}
                ORDER BY neighbor.kind, neighbor.label, edge.id
                LIMIT ? OFFSET ?
                """,
                parameters,
            ).fetchall()
            object_ids = [row["id"] for row in rows]
            identifiers = identifiers_for(database, object_ids)
            evidence = evidence_for(database, [row["connection_id"] for row in rows])

            relations = []
            for row in rows:
                relations.append(
                    {
                        "id": row["connection_id"],
                        "direction": "outgoing" if row["source_id"] == selected["id"] else "incoming",
                        "object": object_payload(row, identifiers.get(row["id"])),
                        "statement": row["statement"],
                        "evidence": evidence.get(row["connection_id"], []),
                    }
                )

        relations.sort(
            key=lambda item: (
                KIND_ORDER.get(item["object"]["kind"], 999),
                item["object"]["label"].casefold(),
                item["id"],
            )
        )
        return jsonify({"items": relations, "limit": limit, "offset": offset, "total": count})

    @app.get("/object.html")
    def legacy_object_route():
        object_id = request.args.get("id", "")
        if object_id:
            with connect() as database:
                row = database.execute(
                    "SELECT path FROM routes WHERE object_id = ?", (object_id,)
                ).fetchone()
            if row:
                return redirect(row["path"], code=308)
        return send_from_directory(ROOT, "object.html")

    @app.get("/<route_kind>/<slug>")
    def object_page(route_kind: str, slug: str):
        if route_kind not in ROUTE_KIND_TO_OBJECT_KIND:
            asset_path = f"{route_kind}/{slug}"
            path = ROOT / asset_path
            if path.is_file() and ROOT in path.resolve().parents:
                return send_from_directory(ROOT, asset_path)
            abort(404)
        with connect() as database:
            selected = route_row(database, route_kind, slug)
            if not selected:
                abort(404)
        if route_kind == "work":
            properties = json.loads(selected["properties"] or "{}")
            work_slug = properties.get("slug") or selected["id"].removeprefix("work:")
            work_page = ROOT / "works" / f"{work_slug}.html"
            if work_page.is_file():
                return send_from_directory(ROOT / "works", f"{work_slug}.html")
        return send_from_directory(ROOT, "object.html")

    @app.get("/", defaults={"asset_path": "index.html"})
    @app.get("/<path:asset_path>")
    def static_site(asset_path: str):
        path = ROOT / asset_path
        if not path.is_file() or ROOT not in path.resolve().parents:
            abort(404)
        return send_from_directory(ROOT, asset_path)

    return app


app = create_app()
