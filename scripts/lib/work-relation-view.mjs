const relationTypes = [
  { id: "authors", label: "Authors" },
  { id: "results", label: "Results" },
  { id: "claims", label: "Claims" },
  { id: "citations", label: "Citations" },
  { id: "versions", label: "Versions" },
  { id: "software", label: "Software" },
  { id: "sources", label: "Sources" },
];

function relationCard(type, object, connection, description = object.description) {
  return {
    id: connection.id,
    type,
    title: object.label,
    description: description || connection.statement,
    statement: connection.statement,
    evidence: connection.evidence || [],
  };
}

function uniqueBy(cards, key) {
  const seen = new Set();
  return cards.filter((card) => {
    const value = key(card);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function versionDescription(version) {
  const details = [version.properties?.date, version.properties?.venue].filter(Boolean);
  return details.length ? details.join(" · ") : version.description;
}

function versionCitation(version) {
  return {
    doi: version.properties?.doi || "",
    url: version.properties?.url || "",
    date: version.properties?.date || "",
    venue: version.properties?.venue || "",
    authors: version.properties?.authors || [],
  };
}

export function createWorkRelationProjector(resourceIndex) {
  const objects = new Map((resourceIndex.objects || []).map((object) => [object.id, object]));
  const sources = new Map((resourceIndex.sources || []).map((source) => [source.id, source]));
  const incoming = new Map();
  const outgoing = new Map();

  for (const connection of resourceIndex.connections || []) {
    incoming.set(connection.target, [...(incoming.get(connection.target) || []), connection]);
    outgoing.set(connection.source, [...(outgoing.get(connection.source) || []), connection]);
  }

  function objectFor(id) {
    return objects.get(id);
  }

  return function projectWork(slug) {
    const workId = `work:${slug}`;
    const work = objectFor(workId);
    if (!work) return { work: null, relationTypes, connections: [] };

    const versionEdges = (incoming.get(workId) || []).filter(
      (connection) => {
        const source = objectFor(connection.source);
        return source?.kind === "publication" && source.properties?.work_id === workId;
      }
    );
    const versionIds = new Set(versionEdges.map((connection) => connection.source));
    const versionConnections = versionEdges
      .map((connection) => {
        const version = objectFor(connection.source);
        return version
          ? {
              ...relationCard("versions", version, connection, versionDescription(version)),
              citation: versionCitation(version),
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.description.localeCompare(a.description));

    const authorConnections = [];
    const resultConnections = [];
    const claimConnections = [];
    const softwareConnections = [];
    const sourceConnections = [];
    const citationConnections = [];

    function addSourceDocument(documentId) {
      const document = objectFor(documentId);
      if (document?.kind !== "source_document") return;
      const connection = (outgoing.get(documentId) || []).find((candidate) => {
        const target = objectFor(candidate.target);
        return target?.kind === "publication";
      });
      if (!connection) return;
      sourceConnections.push({
        ...relationCard("sources", document, connection, connection.statement),
        objectId: document.id,
      });
    }

    for (const versionId of versionIds) {
      for (const connection of outgoing.get(versionId) || []) {
        const target = objectFor(connection.target);
        if (!target) continue;

        if (target.kind === "person") {
          authorConnections.push({
            ...relationCard("authors", target, connection, connection.statement),
            order: connection.properties?.author_position ?? Number.MAX_SAFE_INTEGER,
            objectId: target.id,
          });
        } else if (target.kind === "result") {
          const supportingClaims = (outgoing.get(target.id) || [])
            .map((candidate) => objectFor(candidate.target))
            .filter((candidate) => candidate?.kind === "claim")
            .sort(
              (left, right) =>
                (left.properties?.claim_position ?? Number.MAX_SAFE_INTEGER) -
                  (right.properties?.claim_position ?? Number.MAX_SAFE_INTEGER) ||
                left.id.localeCompare(right.id)
            )
            .map((claim) => ({ objectId: claim.id, statement: claim.description }));
          resultConnections.push({
            ...relationCard("results", target, connection, target.description),
            statement: target.description,
            order: connection.properties?.result_position ?? Number.MAX_SAFE_INTEGER,
            objectId: target.id,
            supportingClaims,
          });
        } else if (target.kind === "claim") {
          claimConnections.push({
            ...relationCard("claims", target, connection, target.description),
            order: connection.properties?.claim_position ?? Number.MAX_SAFE_INTEGER,
            objectId: target.id,
          });
        } else if (target.kind === "software") {
          softwareConnections.push({
            ...relationCard("software", target, connection, target.description),
            objectId: target.id,
          });
        }
      }

      for (const connection of incoming.get(versionId) || []) {
        const source = objectFor(connection.source);
        if (!source) continue;

        if (source.kind === "source_document") {
          addSourceDocument(source.id);
        } else if (source.kind === "claim" && source.properties?.source_work_id) {
          const citingWork = objectFor(source.properties.source_work_id);
          if (!citingWork) continue;
          citationConnections.push({
            ...relationCard("citations", citingWork, connection, citingWork.description),
            objectId: citingWork.id,
          });
        }
      }
    }

    for (const connection of incoming.get(workId) || []) {
      const source = objectFor(connection.source);
      if (!source) continue;

      if (source.kind === "publication" && source.properties?.work_id !== workId) {
        const citingWork = objectFor(source.properties?.work_id);
        if (!citingWork) continue;
        citationConnections.push({
          ...relationCard("citations", citingWork, connection, citingWork.description),
          objectId: citingWork.id,
        });
      } else if (source.kind === "claim" && source.properties?.source_work_id) {
        const citingWork = objectFor(source.properties.source_work_id);
        if (!citingWork) continue;
        citationConnections.push({
          ...relationCard("citations", citingWork, connection, citingWork.description),
          objectId: citingWork.id,
        });
      }
    }

    for (const card of [
      ...claimConnections,
      ...resultConnections,
      ...citationConnections,
      ...versionConnections,
      ...softwareConnections,
    ]) {
      for (const evidence of card.evidence || []) {
        const source = sources.get(evidence.source);
        const documentId = evidence.properties?.document_id || source?.properties?.document_id;
        if (documentId) addSourceDocument(documentId);
      }
    }

    const connections = [
      ...uniqueBy(
        authorConnections.sort((a, b) => a.order - b.order),
        (card) => card.objectId
      ),
      ...uniqueBy(
        resultConnections.sort((a, b) => a.order - b.order),
        (card) => card.objectId
      ),
      ...uniqueBy(
        claimConnections.sort((a, b) => a.order - b.order),
        (card) => card.objectId
      ),
      ...uniqueBy(citationConnections, (card) => card.objectId),
      ...versionConnections,
      ...uniqueBy(softwareConnections, (card) => card.objectId),
      ...uniqueBy(sourceConnections, (card) => card.objectId),
    ].map(({ order, ...card }) => card);

    return {
      work: {
        id: work.id,
        title: work.label,
        description: work.description,
      },
      relationTypes,
      connections,
    };
  };
}
