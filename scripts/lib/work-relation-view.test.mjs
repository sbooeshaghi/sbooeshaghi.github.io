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
  assert.ok(view.connections.some((item) => item.type === "citations" && item.evidence.length));
  assert.ok(view.connections.every((item) => item.title && item.description && item.statement));
  assert.ok(
    view.connections
      .filter((item) => item.type === "versions")
      .every((item) => item.citation && item.citation.url)
  );
});

test("keeps title-changing publication versions under one work", () => {
  const view = projectWork("normalization-for-sampled-count-data");
  assert.equal(view.connections.filter((item) => item.type === "versions").length, 4);
});
