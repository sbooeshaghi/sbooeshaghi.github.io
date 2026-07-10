You are generating a machine-readable paper artifact for a scientific index.

Design principles:
- Irreducibly simple: produce one paper summary and one flat reference inventory.
- Maximal coverage: identify every cited reference you can from the paper, even when the references section is messy.
- Checkable output: every claim about how a reference is used must be grounded in exact spans from the citing paper.
- LLM-first linking: use judgment to connect bibliography entries to body citations across numeric, author-year, superscript, footnote, and prose citation styles.

Inputs:
- The full extracted text of one paper, with page numbers.
- A catalog of known source-work DOI aliases. These aliases are hints only; do not force them.

Task:
1. Read the entire paper text, including references.
2. Summarize the paper itself with one grounded statement and exact evidence spans from the paper. Write two to four concise sentences in this order: motivation, problem, and result. State the science directly; do not begin with phrases such as "this paper", "this study", or "the authors".
3. Build a reference inventory from the whole paper. Prefer the references section, but use the full paper when formatting is irregular.
4. For every reference you can identify, create exactly one object in `references`.
5. Fill `ref` with the shortest stable label you can infer, such as `Booeshaghi et al. 2022`, `[12]`, or a compact raw-reference label.
6. Fill `title`, `doi`, and `year` when you can infer them. Use empty strings or null when unavailable.
7. A DOI belongs to a reference only when it is part of that reference entry. Never copy the paper's own DOI from a page header, footer, watermark, or neighboring reference. When uncertain, leave `doi` empty.
8. For each reference, search the full paper text for where it is used outside the bibliography/reference list.
9. Allowed evidence for `used` references may come from the abstract, introduction, results, discussion, methods, figure/table captions, acknowledgements, data availability, code availability, supplementary-note text, or other prose sections where the paper is making a claim or documenting analysis inputs.
10. Do not use the bibliography/reference-list entry itself as evidence that a reference is `used`.
11. If you can ground the use outside the bibliography/reference list, set `status` to `used`, write one concise `statement` describing the specific claim, method, dataset, software, or prior result supplied by that reference, and include exact evidence spans.
12. A use statement must carry scientific or technical content from its evidence. Generic statements such as "cited for support", "provides prior or methodological support", or "is cited in the surrounding discussion" are invalid.
13. If a reference appears only in the bibliography/reference list, or you cannot confidently connect it to non-bibliography text, set `status` to `unused_or_unresolved`, leave `statement` empty, and use an empty evidence array.
14. Do not assume citation contexts from the bibliography alone. The bibliography identifies candidate references; non-bibliography text establishes how each reference is used.
15. If multiple cited works support the same sentence, create one reference object per cited work and reuse the same evidence span when appropriate.
16. Do not force the known source works to appear. If a known source work is cited, it should appear naturally from the paper.
17. Evidence spans must be copied verbatim from one page's extracted text. Do not smooth, rewrite, fix hyphenation, remove line-number artifacts, or normalize wording inside the span. For a used reference, quote enough of the sentence or clause to show its role; fragments shorter than 40 normalized characters are invalid. If no exact non-bibliography span can be found, mark it `unused_or_unresolved`.
18. Every evidence span should be an uninterrupted substring of the provided page text after whitespace normalization.

Output exactly this JSON shape and no prose:

```json
{
  "paper": {
    "title": "",
    "doi": "",
    "year": null,
    "statement": "",
    "evidence": [
      {"span": "", "page": 1}
    ]
  },
  "references": [
    {
      "ref": "",
      "title": "",
      "doi": "",
      "year": null,
      "status": "used",
      "statement": "",
      "evidence": [
        {"span": "", "page": 1}
      ]
    }
  ]
}
```
