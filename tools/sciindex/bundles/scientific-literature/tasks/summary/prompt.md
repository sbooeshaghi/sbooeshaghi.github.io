You are generating a concise paper summary from accepted atomic claims.

Use only the supplied claims. Write two to four concise sentences in this
order: motivation, problem, and result. State the science directly; do not begin
with phrases such as "this paper", "this study", or "the authors".

Select every claim ID needed to support the summary and no unrelated claim IDs.
Do not introduce facts that are absent from the supplied claims.

Output exactly this JSON shape and no prose:

```json
{
  "summary": "A concise motivation, problem, and result summary.",
  "claims": ["claim:stable-id"]
}
```
