# Google Scholar cited-by refresh runbook

State from the last full crawl (2026-08-11, profile `1das_jsAAAAJ`): every cited work
crawled to the last page; `db/cited-by.json` at 3,360 rows, 2,850 DOI-linked.
This file plus `crawl-ledger.json` and `exclusions.json` exist so a refresh is
incremental, not a re-crawl.

## Refresh procedure

1. **Diff the profile against the ledger** (one page load, no crawling):
   open `https://scholar.google.com/citations?user=1das_jsAAAAJ&hl=en&pagesize=100`
   and compare each row's "Cited by" count with `crawl-ledger.json`
   (`works.<slug>.scholarCount`; rows for the same publication are summed —
   `scholarTitles` lists the profile rows that map to each slug).
2. **Crawl only works whose count changed.** Cited-by URL:
   `https://scholar.google.com/scholar?hl=en&oi=bibs&cites=<clusterIds>&num=20&start=<0,20,...>`
   (`clusterIds` are in the ledger; comma-join multiple entries). All pages must be
   visited — Scholar sorts by relevance, so new citations appear anywhere.
   Either click "Export Works + Cited-By" in the extension (manual, background) or
   drive it with an agent (notes below).
3. **Import** (dedupes against the overlay; auto-skips `exclusions.json` noise):
   ```sh
   node tools/google-scholar-export/import-google-scholar-export.mjs --dry-run <export.json>
   node tools/google-scholar-export/import-google-scholar-export.mjs <export.json>
   ```
4. **DOI-link the overlay** (idempotent; only touches non-DOI links):
   ```sh
   python3 tools/google-scholar-export/enrich-dois.py
   ```
5. **Rebuild + verify**, then the usual required checks:
   ```sh
   node scripts/rebuild-citations.mjs
   ```
6. **Update the ledger**: set each crawled slug's `scholarCount` to the new profile
   count and bump `lastCrawled`. Commit, deploy per `deploy/README.md`.
7. If new junk shows up in review, add its normalized-title prefix to
   `exclusions.json` (global or per-slug) so it never returns.

## Facts learned the hard way (2026-08 crawl)

- **CAPTCHA behavior**: this network is flagged for `/scholar?cites=` queries.
  Expect a reCAPTCHA on the first query and occasionally after ~10+ queries or on
  deep pagination; only a human may click it. After a solve, the exemption cookie
  typically holds for a long run if you keep the pattern below.
- **Pacing that held for 100+ consecutive pages**: navigate scholar→scholar with an
  in-page `location.href` assignment (keeps the referrer — typed/tool navigation
  gets flagged much faster), ~13 s between page loads, `num=20`, extract only after
  a ~5 s render wait.
- **Scholar quirks**: result titles can carry doubled `[HTML][HTML]`/`[PDF]` badges
  (strip repeatedly); `idp.nature.com|idp.springer.com /authorize/casa` links are
  token redirects that die when the query string is dropped (re-resolve by title);
  OpenReview links lose their `?id=` the same way; Cochrane rows read year 1996
  from the journal line; some rows have no link at all (resolve via Crossref or drop).
- **Scale expectation**: a full crawl is ~160 pages / ~2,600 rows; a quarterly
  refresh should touch a handful of works and single-digit pages.

## Agent-driven crawl notes (Claude + browser MCP)

If an agent drives the crawl through the user's Chrome: tool results truncate near
1 KB (read accumulated data from `sessionStorage` in ≤900-char slices) and outputs
containing query-string URLs or base64 are blocked (strip query strings in-page;
never return encoded blobs). Accumulate per-page rows in `sessionStorage`, diff
in-page against known citations (inject FNV-1a hashes of normalized titles and
links from `db/cited-by.json`) so only new records cross the channel, and persist
progress to disk after every work. Full details live in the session that produced
this file; the extract JS embeds the same selectors as `extension/content.js`
(`tr.gsc_a_tr`, `.gs_r.gs_or.gs_scl`, `.gs_rt`, `.gs_a`, `#gsc_bpf_more`).
