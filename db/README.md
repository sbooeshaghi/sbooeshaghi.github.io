# Works and Scientific Index Data

The Works listing reads citation totals from `db/cited-by.json`. Individual
work pages render their relation tabs from the JSON export in
`db/resource-index.json`. The generated local query index is
`db/resource-index.sqlite`.

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

## Resource Index

The bundle builds an accepted object/connection/source graph. The Rust CLI
indexes that graph in `db/resource-index.sqlite` and exports
`db/resource-index.json` for the website. Both representations have one public
shape:

- `objects`: anything searchable and fetchable.
- `connections`: directed links between objects, explained by statements and
  optional evidence.
- `sources`: provenance records that evidence spans can point into.

In the generic view, a `work` is the stable intellectual grouping and a
`publication` is a concrete citable version such as a preprint, journal article,
correction, thesis, or other manifestation. Citation-use explanations should be
encoded as grounded `claim -> publication` or `claim -> work` connections, not
as separate conceptual objects.

The generic runtime, bundle, and query CLI live in the private
[`IndexScience/scidx`](https://github.com/IndexScience/scidx) repository. Point
`SCIDX` at a local checkout, then build, index, export, and verify this corpus:

```sh
export SCIDX=/path/to/scidx
node "$SCIDX/runtime/run-bundle.mjs" --project=. --workspace=local/sciindex verify
node "$SCIDX/runtime/run-bundle.mjs" --project=. --workspace=local/sciindex build
cargo run --manifest-path "$SCIDX/Cargo.toml" -- \
  index local/sciindex/resource-index.json db/resource-index.sqlite
cargo run --manifest-path "$SCIDX/Cargo.toml" -- \
  export db/resource-index.sqlite db/resource-index.json
node "$SCIDX/runtime/verify-index.mjs" \
  --index=db/resource-index.json \
  --recipe="$SCIDX/bundles/scientific-literature/recipe.json"
SKIP_DOI2BIB=1 node scripts/build-work-pages.mjs
```

The SQLite index is generated and ignored by Git. The JSON export is tracked
because the static site loads it without a server.

The generic index is the accepted tool-facing shape. The website relation view
is a compact projection of that graph; it does not maintain a separate set of
authors, claims, citation reasons, versions, software, or source relationships.

The builder belongs to the portable scientific-literature bundle in `scidx`.
This project declares its structured catalog inputs in `scidx.catalog.json`;
the bundle itself contains no website paths. It
imports semantic extractions and structured catalog data only from accepted
artifacts. Known metadata and citations
remain in the graph without fabricated reasons; grounded claim connections
appear after paper-task evidence is accepted.

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

## Local PDFs and Citation Context

Downloaded PDFs should stay local and should not be committed. Put source-work
PDFs under:

```text
local/papers/works/<work-slug>/<version-slug>.pdf
```

Put cited-by PDFs under:

```text
local/papers/cited-by/<cited-by-slug>.pdf
```

The matching extracted text should go under `local/extracts/`. These paths are
ignored by git. Local metadata can be stored in `db/pdf-manifest.local.json`
using `db/pdf-manifest.example.json` as a template.

To list expected PDF targets for source work versions:

```sh
node scripts/list-pdf-targets.mjs --scope=works
```

To list expected targets for cited-by works:

```sh
node scripts/list-pdf-targets.mjs --scope=cited-by
```

Add `--missing` to show only PDFs not present locally, `--json` for structured
output, `--mkdir` to create the corresponding local directories, and `--quiet`
to create directories without printing the target list.

Each publication version is packaged deterministically under
`local/sciindex/source/`. Agent and module tasks write candidates, DOI caches,
verification reports, and accepted artifacts under `local/sciindex/`. Only
verified reports may be accepted, and
`$SCIDX/bundles/scientific-literature/verify.mjs` requires complete
matching coverage and artifact lineage before the public index is rebuilt.
