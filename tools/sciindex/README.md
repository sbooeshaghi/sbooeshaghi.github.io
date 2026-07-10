# sciindex

`sciindex` is a small graph format, a Rust query library/CLI, and a portable
recipe bundle convention for building grounded indexes with agents.

## Boundaries

The system has three layers:

1. A **bundle** defines a domain recipe and agent tasks.
2. A **dataset adapter** ingests verified task artifacts and builds one resource
   index.
3. The **Rust library and CLI** query that index with `search`, `fetch`, and
   `relations`.

Only the resource index crosses into the query layer. The Rust code has no
knowledge of papers, prompts, models, or dataset layouts.

## Resource index

The accepted shape is deliberately small:

```json
{
  "objects": [
    {
      "id": "...",
      "kind": "...",
      "label": "...",
      "description": "...",
      "properties": { "provenance": ["artifact:<producer>:sha256:<hash>"] }
    }
  ],
  "connections": [
    {
      "id": "...",
      "source": "...",
      "target": "...",
      "statement": "...",
      "evidence": [],
      "properties": { "provenance": ["artifact:<producer>:sha256:<hash>"] }
    }
  ],
  "sources": [
    { "id": "...", "kind": "...", "label": "...", "locator": "...", "properties": {} }
  ]
}
```

Connections are untyped. Their statements and evidence explain their meaning.
Objects may carry multiple public or local identifiers in `properties`.
Every object and connection carries one or more content-addressed accepted
artifact IDs in `properties.provenance`. Full extraction and verification
details remain in those artifacts rather than becoming graph entities.

Default CLI output is compact. `--verbose` exposes properties and evidence.
These are query projections over one stored shape, not separate schemas.

## Bundles

A bundle is the portable domain unit:

```text
bundles/<domain>/
  bundle.json
  recipe.json
  lib/                 # deterministic source packaging
  tasks/<task>/
    task.json
    prompt.md
    schema.json
    prepare.mjs
    validate.mjs
```

The recipe defines accepted object kinds, identifier namespaces, connection
patterns, source kinds, and deterministic checks. A task contains everything
needed to prepare an agent input and validate its candidate output. Source
packets are deterministic inputs, not agent tasks.

Every input packet records recipe, task, PDF, and retained-text hashes. A
validator report records the input and output hashes and fails when any check
fails. Only that report may be ingested. Agent output is never accepted
directly. Accepted artifact IDs address the transformed record, including its
paper identity and input provenance, rather than only the raw candidate.
Accepted artifacts are immutable inputs to dataset adapters. A
task validates how its candidate was produced; the generic index verifier
validates the canonical graph after resolution.

Several tasks may produce the same object or connection kind. Structured
metadata extraction, text extraction, and table extraction can therefore use
different schemas and validators while resolving into one canonical record.
The adapter merges their artifact IDs and rejects incompatible identities; it
does not create extraction-method objects in the graph.

The current bundle is `bundles/scientific-literature/`. Scientific interpretation
is split into four small tasks:

1. `claims` reads the complete manuscript and extracts every explicit atomic
   claim with exact evidence spans.
2. `results` groups accepted claims into coherent reported findings. Each
   result is supported by at least two claim IDs and copies no source spans.
   A non-empirical paper may validly produce an empty result list when none of
   its claims form a multi-claim finding.
3. `summary` reads only accepted claim IDs and statements, then writes one
   concise paper description grounded in the selected claims.
4. `references` reads the complete manuscript plus accepted claims, inventories
   the bibliography, and links each used reference to the claims it supports.

This separation prevents a short paper summary from becoming the claim
inventory. Claims are reusable graph objects; results are reusable groupings
over claims; a summary is a projection over accepted claims; reference links
connect cited publications to those same claims. Grounding therefore follows
`source span -> claim -> result` without copying evidence.

A claim displays the agent's concise statement. Its evidence retains exact
source spans verbatim; evidence text is never substituted for the claim.

```bash
node tools/sciindex/verify-bundle.mjs
```

## Dataset pipeline

From the repository root:

```bash
# Prepare all downloaded versions as deterministic source packets
node scripts/prepare-source-packets.mjs --works

# Prepare claim packets from complete paper packets
node tools/sciindex/bundles/scientific-literature/tasks/claims/prepare.mjs \
  --input-dir=local/sciindex/source/inputs

# A model-agnostic orchestrator can distribute these balanced packet manifests
node tools/sciindex/make-batches.mjs \
  --index=local/sciindex/claims/inputs/index.json \
  --out-dir=local/sciindex/claims/batches \
  --batches=4

# After agents write claim candidates
node tools/sciindex/bundles/scientific-literature/tasks/claims/validate.mjs \
  --input-dir=local/sciindex/claims/inputs \
  --output-dir=local/sciindex/claims/outputs

# Create the immutable accepted claim artifact
node scripts/ingest-claims-task.mjs \
  --validation-report=local/sciindex/claims/reports/validation.json

# Prepare downstream results, summaries, and reference links from accepted claims
node tools/sciindex/bundles/scientific-literature/tasks/results/prepare.mjs \
  --claims=local/sciindex/claims/accepted.json
node tools/sciindex/bundles/scientific-literature/tasks/summary/prepare.mjs \
  --claims=local/sciindex/claims/accepted.json
node tools/sciindex/bundles/scientific-literature/tasks/references/prepare.mjs \
  --source-input-dir=local/sciindex/source/inputs \
  --claims=local/sciindex/claims/accepted.json

# Validate and accept the downstream agent candidates
node tools/sciindex/bundles/scientific-literature/tasks/results/validate.mjs \
  --input-dir=local/sciindex/results/inputs \
  --output-dir=local/sciindex/results/outputs
node scripts/ingest-results-task.mjs \
  --validation-report=local/sciindex/results/reports/validation.json

node tools/sciindex/bundles/scientific-literature/tasks/summary/validate.mjs \
  --input-dir=local/sciindex/summary/inputs \
  --output-dir=local/sciindex/summary/outputs
node scripts/ingest-summary-task.mjs \
  --validation-report=local/sciindex/summary/reports/validation.json

node tools/sciindex/bundles/scientific-literature/tasks/references/validate.mjs \
  --input-dir=local/sciindex/references/inputs \
  --output-dir=local/sciindex/references/outputs
node scripts/ingest-references-task.mjs \
  --validation-report=local/sciindex/references/reports/validation.json

# Refuse partial or mismatched four-task corpora before graph construction
node scripts/verify-sciindex-cutover.mjs

# Build and verify the generic graph
node scripts/build-resource-index.mjs
node scripts/verify-resource-index.mjs
```

The dataset adapter is intentionally outside the bundle because it knows about
this repository's publication metadata and citation exports. Complete accepted
task sets for cited papers are projected as citing publications using the same
claim and result objects as owned works.

Agent orchestration is intentionally model-agnostic: an orchestrator reads a
task input index or balanced batch manifest, sends each self-contained packet
to a model, and writes one candidate beside the other task outputs. Validators,
not the orchestrator, define acceptance. The cutover verifier requires exact
paper coverage and claims lineage across all four accepted artifacts.

## Query CLI

```bash
cargo build --manifest-path tools/sciindex/Cargo.toml

cargo run --manifest-path tools/sciindex/Cargo.toml -- \
  --json search "kallisto barcode" --kind work --limit 5

cargo run --manifest-path tools/sciindex/Cargo.toml -- \
  --json fetch 10.1038/s41587-021-00870-2 --verbose

cargo run --manifest-path tools/sciindex/Cargo.toml -- \
  --json relations work:modular-efficient-and-constant-memory-single-cell-rna-seq-preprocessing \
  --direction incoming --include-evidence
```

Aliases that resolve to multiple objects return an explicit ambiguity error.
Callers can then fetch a stable object ID or version-specific URL.

## Design rules

- Keep the accepted graph generic.
- Keep domain knowledge in a portable bundle.
- Keep dataset paths and joins in a dataset adapter.
- Use LLMs for semantic extraction and linking.
- Use deterministic checks for hashes, identifiers, shape, and literal evidence.
- Keep production details in accepted artifacts and only their content-addressed
  IDs on canonical graph records.
- Let source-specific tasks use different validators, then resolve their output
  into shared canonical identities.
- Preserve ungrounded known connections; do not invent reasons for them.
- Give grouping objects such as `work` stable identity when they organize real
  concrete objects.
- Add ontology concepts only when a recurring object has identity and a
  verifier.
