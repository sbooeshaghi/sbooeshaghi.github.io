# Works Citation Data

The Works pages render citation tables from `db/cited-by.json`.

`db/cited-by.json` is generated. Do not edit it by hand. It is built from:

- `db/citations.json`: API-derived citation data from OpenAlex and Semantic Scholar.
- `db/google-scholar-citations.json`: manual overlay from Google Scholar cited-by rows.

`db/publication-authors.json` is also generated. Do not edit it by hand. It
stores per-version author lists for each work, with ORCID links when Crossref
DOI metadata provides them. The author fetcher also reuses ORCID links across
versions of the same work and across the full Works corpus when author names
match unambiguously.

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

This rebuilds `db/cited-by.json`, regenerates `works/*.html`, and verifies that
every rendered row traces back to API data or the Google Scholar overlay. It also
verifies that every work page has author metadata for each listed DOI version.

To refresh API citation data, run:

```sh
node scripts/fetch-citations.mjs
```

The fetcher refuses to overwrite `db/citations.json` if API failures would produce fewer rows than the existing cache. If you intentionally want to keep a partial result, run it with `CITATION_FETCH_ALLOW_PARTIAL=1`.

To refresh author metadata, run:

```sh
node scripts/fetch-publication-authors.mjs
```

This queries Crossref for each DOI in `db/publications.json` and rewrites
`db/publication-authors.json`.
