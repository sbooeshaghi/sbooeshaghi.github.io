# Paper task

This task turns one complete paper into a grounded summary and a flat inventory
of its references. It is deliberately LLM-first: the model identifies references
and citation contexts; deterministic code prepares sources and verifies shape,
provenance, literal evidence, and identifier consistency where trusted metadata
is available.

The directory is self-contained:

- `task.json` names the task components;
- `prompt.md` is the complete agent instruction;
- `schema.json` defines candidate output;
- `prepare.mjs` creates hashed input packets and retained text sources;
- `validate.mjs` verifies shape, provenance, and exact evidence spans.

## Candidate shape

```json
{
  "paper": {
    "title": "",
    "doi": "",
    "year": null,
    "statement": "",
    "evidence": [{ "span": "", "page": 1 }]
  },
  "references": [
    {
      "ref": "",
      "title": "",
      "doi": "",
      "year": null,
      "status": "used",
      "statement": "",
      "evidence": [{ "span": "", "page": 1 }]
    }
  ]
}
```

## Prepare

Run from the dataset root. Set `SCIINDEX_ROOT` only when invoking the task from
another working directory.

```bash
# A generic manifest shaped as {"papers": [...]}
node tools/sciindex/bundles/scientific-literature/tasks/paper/prepare.mjs \
  --manifest=papers.json --catalog=known-identifiers.json

# Any PDF
node tools/sciindex/bundles/scientific-literature/tasks/paper/prepare.mjs \
  --pdf=local/papers/example.pdf
```

Inputs and retained normalized text default to `local/sciindex/paper/`. Give an
agent the complete input packet and save only its JSON result in `outputs/`.
Repository-specific PDF manifests and citation exports must be translated into
the generic paper manifest by a dataset adapter outside this bundle.

## Validate

```bash
node tools/sciindex/bundles/scientific-literature/tasks/paper/validate.mjs \
  --input-dir=local/sciindex/paper/inputs \
  --output-dir=local/sciindex/paper/outputs
```

Validation checks the current recipe hash, task hash, PDF hash, retained text
hash, candidate shape, every evidence span, non-generic citation-use statements,
and DOI/title consistency for known objects. It exits unsuccessfully when any
paper fails. The resulting validation report is the only artifact a dataset
adapter may import.

When several reference rows reuse the same evidence, a dataset adapter should
emit one claim object for that grounded context and connect it to each resolved
reference. The repeated rows are an extraction convenience, not separate
scientific claims.

Ingestion assigns each accepted paper output a content-addressed artifact ID.
Canonical objects and connections retain that ID in `properties.provenance`;
the complete task input, candidate, source hashes, and validation report remain
outside the graph. Another task may discover the same canonical record through
metadata or tables and contribute another artifact ID after its own validator
passes.
