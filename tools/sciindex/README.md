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
    { "id": "...", "kind": "...", "label": "...", "description": "...", "properties": {} }
  ],
  "connections": [
    { "id": "...", "source": "...", "target": "...", "statement": "...", "evidence": [], "properties": {} }
  ],
  "sources": [
    { "id": "...", "kind": "...", "label": "...", "locator": "...", "properties": {} }
  ]
}
```

Connections are untyped. Their statements and evidence explain their meaning.
Objects may carry multiple public or local identifiers in `properties`.

Default CLI output is compact. `--verbose` exposes properties and evidence.
These are query projections over one stored shape, not separate schemas.

## Bundles

A bundle is the portable domain unit:

```text
bundles/<domain>/
  bundle.json
  recipe.json
  tasks/<task>/
    task.json
    prompt.md
    schema.json
    prepare.mjs
    validate.mjs
```

The recipe defines accepted object kinds, identifier namespaces, connection
patterns, source kinds, and deterministic checks. A task contains everything
needed to prepare an agent input and validate its candidate output.

Every input packet records recipe, task, PDF, and retained-text hashes. A
validator report records the input and output hashes and fails when any check
fails. Only that report may be ingested. Agent output is never accepted
directly, and accepted artifacts are immutable inputs to dataset adapters.

The current bundle is
`bundles/scientific-literature/`. Its `paper` task reads a complete paper,
produces one grounded summary and one flat reference inventory, and exact-matches
every evidence span against retained text.

```bash
node tools/sciindex/verify-bundle.mjs
```

## Dataset pipeline

From the repository root:

```bash
# Prepare all downloaded versions of the author's works
node scripts/prepare-paper-task.mjs --works

# After agents write JSON outputs
node tools/sciindex/bundles/scientific-literature/tasks/paper/validate.mjs \
  --input-dir=local/sciindex/paper/inputs \
  --output-dir=local/sciindex/paper/outputs

# Create the immutable accepted task artifact
node scripts/ingest-paper-task.mjs \
  --validation-report=local/sciindex/paper/reports/validation.json

# Build and verify the generic graph
node scripts/build-resource-index.mjs
node scripts/verify-resource-index.mjs
```

The dataset adapter is intentionally outside the bundle because it knows about
this repository's publication metadata and citation exports.

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
- Preserve ungrounded known connections; do not invent reasons for them.
- Give grouping objects such as `work` stable identity when they organize real
  concrete objects.
- Add ontology concepts only when a recurring object has identity and a
  verifier.
