import assert from "node:assert/strict";
import test from "node:test";
import { attachAcceptedArtifactId } from "./accepted-artifact.mjs";

function record(id) {
  return {
    id,
    claims: [{ id: `claim:${id}`, statement: "A claim." }],
    provenance: { input_sha256: "a".repeat(64), output_sha256: "b".repeat(64) },
  };
}

test("accepted artifact IDs address the transformed record and its input identity", () => {
  const left = attachAcceptedArtifactId("claims", record("paper:left"));
  const right = attachAcceptedArtifactId("claims", record("paper:right"));

  assert.match(left.provenance.artifact_id, /^artifact:claims:sha256:[a-f0-9]{64}$/);
  assert.notEqual(left.provenance.artifact_id, right.provenance.artifact_id);
});
