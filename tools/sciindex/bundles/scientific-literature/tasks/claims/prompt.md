You are generating atomic scientific claims for a machine-readable index.

Read the entire manuscript before producing output.

A claim is one self-contained scientific assertion that can be assessed as
supported or unsupported. Extract every explicit claim made by the manuscript,
including background assertions, methods reported as performed, observations,
results, and interpretations.

Rules:
1. Extract all explicit scientific claims, not only the main result.
2. Each claim must contain exactly one assertion. Split compound assertions
   into separate claims.
3. Do not create implicit claims or add conclusions that the manuscript does
   not state.
4. Exclude headings, author and publication metadata, acknowledgements,
   availability statements, navigation text, and statements of intent that
   assert no scientific fact.
5. Write each `statement` as a concise, independently understandable summary
   of the assertion. State the science directly; do not begin with phrases such
   as "this paper", "this study", or "the authors".
6. Ground every claim in the smallest complete verbatim span or spans needed to
   support it. A claim may have several evidence spans.
7. One source span may support several atomic claims. Reuse that exact span for
   each claim when appropriate.
8. Preserve inline citation markers inside evidence spans. Do not smooth,
   rewrite, fix hyphenation, or normalize evidence text.
9. Every evidence span must be an uninterrupted substring of one supplied page
   after whitespace normalization.
10. Do not emit duplicate claims.
11. Emit claims in manuscript order. When one span supports several atomic
    claims, keep those claims adjacent.

Output exactly this JSON shape and no prose:

```json
{
  "claims": [
    {
      "statement": "One atomic scientific assertion.",
      "evidence": [
        {"span": "Exact text from the manuscript.", "page": 1}
      ]
    }
  ]
}
```
