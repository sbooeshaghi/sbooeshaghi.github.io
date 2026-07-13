import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bucketForObjectId, createObjectViewProjector } from "./object-view.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resourceIndex = JSON.parse(
  fs.readFileSync(path.join(rootDir, "db", "resource-index.json"), "utf8")
);
const projectObject = createObjectViewProjector(resourceIndex);

test("assigns object IDs to stable bounded buckets", () => {
  const id = "person:orcid:0000-0002-6442-4502";
  assert.equal(bucketForObjectId(id), bucketForObjectId(id));
  assert.ok(bucketForObjectId(id) >= 0 && bucketForObjectId(id) < 64);
});

test("projects a person with canonical identifiers and publication relations", () => {
  const view = projectObject("person:orcid:0000-0002-6442-4502");
  assert.equal(view.object.kind, "person");
  assert.ok(view.object.identifiers.some((identifier) => identifier.namespace === "orcid"));
  assert.ok(view.object.identifiers.every((identifier) => identifier.namespace !== "local"));
  assert.ok(view.relations.some((relation) => relation.object.kind === "publication"));
});

test("projects claim evidence as exact spans linked to source documents", () => {
  const claim = resourceIndex.objects.find(
    (object) =>
      object.kind === "claim" &&
      (object.properties?.evidence || []).some((evidence) => evidence.properties?.document_id)
  );
  assert.ok(claim);
  const view = projectObject(claim.id);
  const grounded = view.relations.find((relation) => relation.evidence.length);
  assert.ok(grounded);
  assert.equal(grounded.evidence[0].span, claim.properties.evidence[0].span);
  assert.ok(grounded.evidence[0].source.id.startsWith("document:"));
  assert.equal("page" in grounded.evidence[0], false);
});

test("does not expose local source paths in source-document views", () => {
  const document = resourceIndex.objects.find((object) => object.kind === "source_document");
  const view = projectObject(document.id);
  assert.equal(view.object.description, "Source document retained for grounded evidence.");
  assert.ok(!JSON.stringify(view).includes("local/papers/"));
  assert.ok(!JSON.stringify(view).includes("local/sciindex/"));
});

test("returns null for an unknown object", () => {
  assert.equal(projectObject("object:missing"), null);
});
