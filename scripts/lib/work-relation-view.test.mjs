import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorkRelationProjector } from "./work-relation-view.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resourceIndex = JSON.parse(
  fs.readFileSync(path.join(rootDir, "db", "resource-index.json"), "utf8")
);
const projectWork = createWorkRelationProjector(resourceIndex);

test("projects graph objects into the six work-page tabs", () => {
  const view = projectWork(
    "modular-efficient-and-constant-memory-single-cell-rna-seq-preprocessing"
  );
  assert.deepEqual(
    view.relationTypes.map((type) => type.id),
    ["authors", "claims", "citations", "versions", "software", "sources"]
  );
  assert.equal(view.connections.filter((item) => item.type === "authors").length, 10);
  assert.ok(view.connections.some((item) => item.type === "citations"));
  assert.ok(view.connections.every((item) => item.title && item.description && item.statement));
  assert.ok(
    view.connections
      .filter((item) => item.type === "versions")
      .every((item) => item.citation && item.citation.url)
  );
  assert.ok(
    view.connections
      .filter((item) => item.type === "sources")
      .every((item) => item.objectId?.startsWith("document:"))
  );
  const sourceObjectIds = new Set(
    view.connections.filter((item) => item.type === "sources").map((item) => item.objectId)
  );
  for (const connection of view.connections) {
    for (const evidence of connection.evidence || []) {
      assert.ok(sourceObjectIds.has(evidence.properties?.document_id));
    }
  }
});

test("keeps title-changing publication versions under one work", () => {
  const view = projectWork("normalization-for-sampled-count-data");
  assert.equal(view.connections.filter((item) => item.type === "versions").length, 4);
});

test("represents one citation context as one claim with multiple cited targets", () => {
  const objects = new Map(resourceIndex.objects.map((object) => [object.id, object]));
  const sharedClaim = resourceIndex.objects.find((object) => {
    if (object.kind !== "claim") return false;
    return (
      resourceIndex.connections.filter((connection) => {
        if (connection.source !== object.id) return false;
        return ["publication", "work"].includes(objects.get(connection.target)?.kind);
      }).length > 1
    );
  });
  assert.ok(sharedClaim);

  const citationConnections = resourceIndex.connections.filter(
    (connection) =>
      connection.source === sharedClaim.id &&
      ["publication", "work"].includes(objects.get(connection.target)?.kind)
  );
  assert.ok(citationConnections.length > 1);
  assert.ok(
    resourceIndex.connections.some(
      (connection) =>
        connection.source === sharedClaim.properties.source_publication_id &&
        connection.target === sharedClaim.id
    )
  );
});

test("projects direct ungrounded publication citations without treating them as versions", () => {
  const index = {
    objects: [
      { id: "work:target", kind: "work", label: "Target", description: "Target work", properties: {} },
      { id: "version:target", kind: "publication", label: "Target v1", description: "", properties: { work_id: "work:target" } },
      { id: "work:citing", kind: "work", label: "Citing", description: "Citing work", properties: {} },
      { id: "version:citing", kind: "publication", label: "Citing v1", description: "", properties: { work_id: "work:citing" } },
    ],
    connections: [
      { id: "version", source: "version:target", target: "work:target", statement: "Version", evidence: [], properties: {} },
      { id: "citation", source: "version:citing", target: "work:target", statement: "Citing cites Target.", evidence: [], properties: {} },
    ],
  };

  const view = createWorkRelationProjector(index)("target");
  assert.deepEqual(view.connections.filter((item) => item.type === "versions").map((item) => item.id), ["version"]);
  assert.deepEqual(view.connections.filter((item) => item.type === "citations").map((item) => item.id), ["citation"]);
});
