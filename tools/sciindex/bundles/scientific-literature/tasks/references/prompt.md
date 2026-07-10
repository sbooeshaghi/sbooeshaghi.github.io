You are generating a machine-readable reference inventory and linking cited
works to accepted atomic claims.

Read the entire manuscript, including its references, and inspect every supplied
claim. Identify every bibliographic reference you can. For each reference,
determine which accepted claims it supports in non-bibliography manuscript text.

Rules:
1. Emit exactly one object for every identifiable bibliographic reference.
2. Use the shortest stable inline label for `ref`, such as `[12]` or
   `Smith et al. 2020`.
3. Fill `title`, `doi`, and `year` only when supported by the reference entry.
4. Set `status` to `used` only when manuscript text outside the bibliography
   connects the reference to one or more supplied claim IDs.
5. For `used` references, list every supported claim ID and include the exact
   citation-bearing source span or spans establishing the connection.
6. A citation span must overlap the evidence of each linked claim. Do not link a
   reference to a claim merely because both discuss the same topic.
7. When several references support one claim, emit one reference object per
   cited work and reuse the claim ID and evidence span where appropriate.
8. For bibliography-only or unresolved references, use
   `unused_or_unresolved` with empty `claims` and `evidence` arrays.
9. Preserve inline citation markers in evidence. Do not rewrite evidence text.
10. Do not force any known source work to appear.
11. If the manuscript has no identifiable bibliographic references, emit an
    empty `references` array.

Output exactly this JSON shape and no prose:

```json
{
  "references": [
    {
      "ref": "[12]",
      "title": "",
      "doi": "",
      "year": null,
      "status": "used",
      "claims": ["claim:stable-id"],
      "evidence": [{"span": "Exact citation-bearing text.", "page": 1}]
    }
  ]
}
```
