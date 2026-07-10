const PRODUCER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_REF_PATTERN = /^artifact:([a-z0-9]+(?:-[a-z0-9]+)*):sha256:([a-f0-9]{64})$/;

export function artifactRef(producerId, sha256) {
  const producer = String(producerId || "").trim();
  const hash = String(sha256 || "").trim().toLowerCase();
  if (!hash) return "";
  if (!PRODUCER_ID_PATTERN.test(producer)) {
    throw new Error(`Invalid artifact producer id: ${producer}`);
  }
  if (!SHA256_PATTERN.test(hash)) throw new Error(`Invalid artifact sha256: ${hash}`);
  return `artifact:${producer}:sha256:${hash}`;
}

export function isArtifactRef(value) {
  return ARTIFACT_REF_PATTERN.test(String(value || ""));
}

export function provenanceRefs(...values) {
  const refs = values.flat(Infinity).filter(Boolean);
  refs.forEach((ref) => {
    if (!isArtifactRef(ref)) throw new Error(`Invalid provenance artifact reference: ${ref}`);
  });
  return [...new Set(refs)].sort();
}

export function withProvenance(properties = {}, ...refs) {
  return {
    ...properties,
    provenance: provenanceRefs(properties.provenance || [], ...refs),
  };
}

export function mergeProvenanceProperties(left = {}, right = {}) {
  return {
    ...left,
    provenance: provenanceRefs(left.provenance || [], right.provenance || []),
  };
}
