import { sha256 } from "../../tools/sciindex/bundles/scientific-literature/lib/common.mjs";
import { artifactRef } from "../../tools/sciindex/provenance.mjs";

export function acceptedArtifactId(producer, record) {
  const provenance = { ...(record.provenance || {}) };
  delete provenance.artifact_id;
  return artifactRef(producer, sha256(JSON.stringify({ ...record, provenance })));
}

export function attachAcceptedArtifactId(producer, record) {
  record.provenance.artifact_id = acceptedArtifactId(producer, record);
  return record;
}
