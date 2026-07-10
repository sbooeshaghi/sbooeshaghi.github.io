# Claims task

This task extracts every explicit atomic scientific claim from one complete
paper. Each claim contains only a concise statement and one or more exact source
spans. The validator checks the input hashes, output shape, exact span grounding,
and duplicate claim signatures.

The task deliberately does not classify claims, infer implicit claims, summarize
the paper, or resolve references. Those are separate tasks over accepted claims.

```bash
node tools/sciindex/bundles/scientific-literature/tasks/claims/prepare.mjs \
  --input=local/sciindex/source/inputs/example.input.json

node tools/sciindex/bundles/scientific-literature/tasks/claims/validate.mjs \
  --input-dir=local/sciindex/claims/inputs \
  --output-dir=local/sciindex/claims/outputs
```
