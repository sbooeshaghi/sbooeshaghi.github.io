# Works Citation Data

The Works pages render citation tables from `db/cited-by.json`.

`db/cited-by.json` is generated. Do not edit it by hand. It is built from:

- `db/citations.json`: API-derived citation data from OpenAlex and Semantic Scholar.
- `db/google-scholar-citations.json`: manual overlay from Google Scholar cited-by rows.

Manual Google Scholar rows use this minimal shape:

```json
{
  "title": "Citing work title",
  "link": "https://example.org/citing-work",
  "year": 2026,
  "summary": ""
}
```

Keep `summary` blank until there is real citation-context text or a manually written note based on the citing work. Do not use placeholder summaries that merely say the citation exists.

After editing citation data, run:

```sh
node scripts/rebuild-citations.mjs
```

This rebuilds `db/cited-by.json`, regenerates `works/*.html`, and verifies that every rendered row traces back to API data or the Google Scholar overlay.

To refresh API citation data, run:

```sh
node scripts/fetch-citations.mjs
```

The fetcher refuses to overwrite `db/citations.json` if API failures would produce fewer rows than the existing cache. If you intentionally want to keep a partial result, run it with `CITATION_FETCH_ALLOW_PARTIAL=1`.
