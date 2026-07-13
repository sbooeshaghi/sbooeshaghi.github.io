const KIND_ORDER = new Map(
  ["work", "publication", "person", "result", "claim", "software", "source_document"].map(
    (kind, index) => [kind, index]
  )
);

function publicIdentifiers(object) {
  const seen = new Set();
  return (object.properties?.identifiers || []).filter((identifier) => {
    if (!identifier?.namespace || !identifier?.value || identifier.namespace === "local") {
      return false;
    }
    const key = `${identifier.namespace}:${identifier.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicDescription(object) {
  if (object.kind === "source_document") {
    return "Source document retained for grounded evidence.";
  }
  const description = String(object.description || "").trim();
  return description === String(object.label || "").trim() ? "" : description;
}

function publicObject(object) {
  return {
    id: object.id,
    kind: object.kind,
    label: object.label,
    description: publicDescription(object),
    identifiers: publicIdentifiers(object),
  };
}

export function bucketForObjectId(id, bucketCount = 64) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % bucketCount;
}

export function createObjectViewProjector(resourceIndex) {
  const objects = new Map((resourceIndex.objects || []).map((object) => [object.id, object]));
  const sources = new Map((resourceIndex.sources || []).map((source) => [source.id, source]));
  const adjacent = new Map();

  for (const connection of resourceIndex.connections || []) {
    adjacent.set(connection.source, [...(adjacent.get(connection.source) || []), connection]);
    if (connection.target !== connection.source) {
      adjacent.set(connection.target, [...(adjacent.get(connection.target) || []), connection]);
    }
  }

  function projectEvidence(evidence) {
    const source = sources.get(evidence.source);
    const documentId =
      evidence.properties?.document_id ||
      source?.properties?.document_id ||
      (String(evidence.source || "").startsWith("document:") ? evidence.source : "");
    const document = objects.get(documentId);
    return {
      span: evidence.span,
      source: document
        ? { id: document.id, label: document.label }
        : source
          ? { label: source.label }
          : null,
    };
  }

  return function projectObject(id) {
    const object = objects.get(id);
    if (!object) return null;

    const relations = (adjacent.get(id) || [])
      .map((connection) => {
        const outgoing = connection.source === id;
        const neighbor = objects.get(outgoing ? connection.target : connection.source);
        if (!neighbor) return null;
        const projectedNeighbor = publicObject(neighbor);
        return {
          id: connection.id,
          direction: outgoing ? "outgoing" : "incoming",
          object: {
            ...projectedNeighbor,
            description: projectedNeighbor.description || connection.statement,
          },
          statement: connection.statement,
          evidence: (connection.evidence || []).map(projectEvidence),
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const kindDifference =
          (KIND_ORDER.get(left.object.kind) ?? Number.MAX_SAFE_INTEGER) -
          (KIND_ORDER.get(right.object.kind) ?? Number.MAX_SAFE_INTEGER);
        return (
          kindDifference ||
          left.object.label.localeCompare(right.object.label) ||
          left.id.localeCompare(right.id)
        );
      });

    return {
      object: publicObject(object),
      relations,
    };
  };
}
