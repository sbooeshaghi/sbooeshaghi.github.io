# Google Scholar cited-by export

Small browser-side helper for exporting a Google Scholar profile and cited-by pages into the site citation overlay.

This intentionally does not scrape Google Scholar from a server. It runs inside your normal browser session, on pages you open yourself, and writes JSON files you can inspect before importing.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select `tools/google-scholar-export/extension`.

## Export workflow

1. Open a Scholar profile, for example:
   `https://scholar.google.com/citations?user=1das_jsAAAAJ&hl=en`
2. Use the floating Scholar Export panel.
3. Click `Export Works + Cited-By`.
4. The extension loads all profile rows, records the full work list, opens each cited-by results page in the current tab, follows Scholar pagination with long randomized delays, and downloads one combined JSON file when the crawl finishes.

For a smaller test, click `Export Works JSON`, open one work's `Cited by` link, then click `Start Cited-By Crawl` on that cited-by results page.

If Google Scholar shows a CAPTCHA, rate limit, or unusual traffic page, the extension pauses without clearing the crawl queue. Complete the check manually if you want to continue, then click `Resume Crawl`; otherwise click `Stop Crawl` and retry later.

The all-works crawl is intentionally slow. Scholar can still interrupt it, especially for profiles with many cited-by pages.

## Import

After downloading the batch export or one or more cited-by JSON exports:

```bash
node tools/google-scholar-export/import-google-scholar-export.mjs --dry-run ~/Downloads/scholar-cited-by-*.json
node tools/google-scholar-export/import-google-scholar-export.mjs ~/Downloads/scholar-cited-by-*.json
node scripts/rebuild-citations.mjs
```

The importer updates `db/google-scholar-citations.json`. It only stores the minimal cited-by fields used by the site:

```json
{
  "title": "Citing work title",
  "link": "https://example.org/work",
  "year": 2026,
  "summary": ""
}
```

The combined batch export includes both `profileWorks` for the full Scholar profile list and `works` entries that pair each work with its cited-by rows. Works without cited-by rows remain in the batch with an empty `cited_by` list.
