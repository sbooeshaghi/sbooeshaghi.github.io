import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactRef,
  isArtifactRef,
  mergeProvenanceProperties,
  provenanceRefs,
  withProvenance,
} from "./provenance.mjs";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const refA = `artifact:paper:sha256:${hashA}`;
const refB = `artifact:metadata:sha256:${hashB}`;

test("artifactRef creates a content-addressed producer identifier", () => {
  assert.equal(artifactRef("paper", hashA.toUpperCase()), refA);
  assert.equal(artifactRef("paper", ""), "");
  assert.equal(isArtifactRef(refA), true);
  assert.equal(isArtifactRef("paper:a"), false);
});

test("provenanceRefs deduplicates and sorts references", () => {
  assert.deepEqual(provenanceRefs(refB, [refA, refB]), [refB, refA].sort());
  assert.throws(() => provenanceRefs("artifact:paper:sha256:nope"));
});

test("properties retain only compact merged artifact references", () => {
  const left = withProvenance({ identifiers: [] }, refA);
  const merged = mergeProvenanceProperties(left, withProvenance({}, refB));
  assert.deepEqual(merged, {
    identifiers: [],
    provenance: [refA, refB].sort(),
  });
});
