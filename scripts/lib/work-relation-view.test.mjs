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

test("projects graph objects into the seven work-page tabs", () => {
  const view = projectWork(
    "modular-efficient-and-constant-memory-single-cell-rna-seq-preprocessing"
  );
  assert.deepEqual(
    view.relationTypes.map((type) => type.id),
    ["authors", "results", "claims", "citations", "versions", "software", "sources"]
  );
  assert.equal(view.connections.filter((item) => item.type === "authors").length, 10);
  assert.ok(
    view.connections
      .filter((item) => item.type === "authors")
      .some((item) =>
        item.identifiers.some(
          (identifier) =>
            identifier.namespace === "orcid" &&
            identifier.value.startsWith("https://orcid.org/")
        )
      )
  );
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

test("orders accepted claims by manuscript position", () => {
  const index = {
    objects: [
      { id: "work:ordered", kind: "work", label: "Ordered", description: "", properties: {} },
      { id: "version:ordered", kind: "publication", label: "Ordered v1", description: "", properties: { work_id: "work:ordered" } },
      { id: "claim:second", kind: "claim", label: "Second", description: "Second", properties: {} },
      { id: "claim:first", kind: "claim", label: "First", description: "First", properties: {} },
    ],
    connections: [
      { id: "version", source: "version:ordered", target: "work:ordered", statement: "Version", evidence: [], properties: {} },
      { id: "second", source: "version:ordered", target: "claim:second", statement: "Contains", evidence: [], properties: { claim_position: 2 } },
      { id: "first", source: "version:ordered", target: "claim:first", statement: "Contains", evidence: [], properties: { claim_position: 1 } },
    ],
  };

  const claims = createWorkRelationProjector(index)("ordered").connections.filter(
    (item) => item.type === "claims"
  );
  assert.deepEqual(claims.map((item) => item.title), ["First", "Second"]);
});

test("projects results with their supporting claims", () => {
  const index = {
    objects: [
      { id: "work:results", kind: "work", label: "Results", description: "", properties: {} },
      { id: "version:results", kind: "publication", label: "Results v1", description: "", properties: { work_id: "work:results" } },
      { id: "result:one", kind: "result", label: "Grouped result", description: "Grouped result", properties: {} },
      { id: "claim:one", kind: "claim", label: "One", description: "Claim one", properties: { claim_position: 1 } },
      { id: "claim:two", kind: "claim", label: "Two", description: "Claim two", properties: { claim_position: 2 } },
    ],
    connections: [
      { id: "version", source: "version:results", target: "work:results", statement: "Version", evidence: [], properties: {} },
      { id: "result", source: "version:results", target: "result:one", statement: "Reports", evidence: [], properties: { result_position: 1 } },
      { id: "claim-one", source: "version:results", target: "claim:one", statement: "Contains", evidence: [], properties: { claim_position: 1 } },
      { id: "claim-two", source: "version:results", target: "claim:two", statement: "Contains", evidence: [], properties: { claim_position: 2 } },
      { id: "support-two", source: "result:one", target: "claim:two", statement: "Supports", evidence: [], properties: {} },
      { id: "support-one", source: "result:one", target: "claim:one", statement: "Supports", evidence: [], properties: {} },
    ],
  };

  const result = createWorkRelationProjector(index)("results").connections.find(
    (item) => item.type === "results"
  );
  assert.equal(result.description, "Grouped result");
  assert.deepEqual(result.supportingClaims, [
    { objectId: "claim:one", statement: "Claim one" },
    { objectId: "claim:two", statement: "Claim two" },
  ]);
});
