# AI-native index infrastructure

The reusable unit is not a website or a one-off extraction script. It is a
portable domain bundle plus a generic accepted graph and query interface.

## Domain setup

A human and an agent define:

1. the objects worth indexing;
2. which object kinds may connect;
3. the public or local identifiers each object may carry;
4. the deterministic checks that make each object, connection, and source
   acceptable.

That definition is the recipe. It is a small meta-ontology over existing
identifiers such as DOI, ORCID, Ensembl, PMID, repository URLs, and package
registries. Extracted objects without public identifiers, such as claims, use
stable local IDs and exact source evidence.

The recipe is executable configuration, not descriptive documentation. It can
generate an empty storage contract, task skeletons, verifier wiring, and query
facets. Domain code still supplies the source adapters and the actual checks
named by the recipe. An agent can then populate candidates, but only verified
candidates cross into the accepted graph.

Objects should have independent identity, extracted identity, or useful
grouping identity. A `work` can group concrete publication versions. A `person`
can carry ORCID. A claim can be identified by its source and content. Contextual
roles such as author or citation use are connections, not new object kinds.

A claim is a concise LLM-generated statement grounded by one or more verbatim
source spans. The summary is the claim's label and description; the spans stay
in its evidence. A claim belongs to the publication that contains its grounded
text. When one claim cites several publications, the graph stores one claim
object and one outgoing connection from that claim to each cited publication. The shared
evidence stays on the claim and its connections; each connection statement can
still explain the distinct role of that cited publication. This represents a
many-reference citation context without inventing a `citation_use` object.
If a cited item cannot yet be resolved to an indexed object, its verified
reference record remains in the accepted task artifact, but the adapter does
not fabricate a graph endpoint or connection.

Connections stay untyped until a demonstrated query requires otherwise. Their
natural-language statement and evidence explain how the endpoints are related.
This keeps LLM judgment useful without forcing every domain into a brittle
relation vocabulary.

## Operational contract

```text
source
  -> hashed task input
  -> agent candidate
  -> deterministic validation report
  -> immutable accepted artifact
  -> dataset adapter
  -> resource index
  -> search / fetch / relations / site
```

The validation report is the trust boundary. It binds the candidate to the
recipe, task, input, output, PDF, and retained normalized text by hash. The
adapter refuses stale, modified, partial, or invalid reports.

The LLM performs work that benefits from interpretation: summarization,
reference identification, semantic linking, and concise connection statements.
Code performs checks that can be made exact: schema shape, file hashes,
identifier namespaces, endpoint existence, allowed connection patterns, and
literal evidence matching.

## Portable bundle

A bundle contains one recipe and self-contained tasks. A task contains a
manifest, prompt, candidate schema, source preparer, and validator. It must not
contain paths or joins specific to one dataset.

A dataset adapter is separate. It knows how local metadata maps to the recipe,
deduplicates objects, normalizes repeated citation evidence into shared claim
objects, preserves known but ungrounded connections, and writes the generic
resource index.

The query library is separate again. It reads only objects, connections, and
sources. This makes the same binary usable for scientific papers, genes,
software, legal records, archival collections, or another domain bundle.

## Evolution

Agents may propose recurring objects that the recipe cannot represent. A useful
proposal needs examples, an identifier strategy, and a deterministic verifier.
A human accepts or rejects the recipe change. Agents may expand the graph
autonomously; they may not silently mutate its ontology.

The system should grow only in response to concrete indexed objects and useful
queries. New schemas, relation labels, workflow layers, and databases are not
added preemptively.
