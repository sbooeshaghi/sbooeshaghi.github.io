# Google Scholar cited-by refresh runbook

Google Scholar has **no API** — citation data can only be read from Scholar's web
pages, inside a real, logged-in browser session. Server-side scraping gets blocked
immediately and is deliberately not part of this repo. There are two supported
ways to run a refresh, both browser-based:

- **A human** runs the bundled Chrome extension (`extension/`, see `README.md`).
- **An AI agent** drives the user's Chrome via browser tooling, following the
  playbook in this file. The playbook is self-contained: everything below was
  validated during the 2026-08-11 full crawl (~160 pages, 470 new citations)
  and requires no context beyond this repo.

State from that crawl: `db/cited-by.json` at 3,360 rows (2,850 DOI-linked);
`crawl-ledger.json` records every work's Scholar count and cluster ids.

## Refresh procedure (both modes)

1. **Diff the profile against the ledger** — one page load, no crawling:
   `https://scholar.google.com/citations?user=1das_jsAAAAJ&hl=en&pagesize=100`.
   Compare each row's "Cited by" count with `crawl-ledger.json`
   (`works.<slug>.scholarCount`; multiple profile rows can map to one slug — see
   `scholarTitles` — sum them). Only works whose count changed need crawling.
2. **Crawl the changed works' cited-by pages** (all pages of each — Scholar sorts
   by relevance, so new citations appear anywhere, not just on page 1):
   `https://scholar.google.com/scholar?hl=en&oi=bibs&cites=<clusterIds>&num=20&start=<0,20,40,...>`
   with `clusterIds` comma-joined from the ledger.
3. **Import** (dedupes against the overlay; auto-skips `exclusions.json` noise):
   ```sh
   node tools/google-scholar-export/import-google-scholar-export.mjs --dry-run <export.json>
   node tools/google-scholar-export/import-google-scholar-export.mjs <export.json>
   ```
4. **DOI-link the overlay** (idempotent; leaves non-DOI-resolvable links alone):
   ```sh
   python3 tools/google-scholar-export/enrich-dois.py
   ```
5. **Rebuild + verify**: `node scripts/rebuild-citations.mjs`, then the required
   checks from `AGENTS.md`.
6. **Update `crawl-ledger.json`**: new `scholarCount` per crawled slug, bump
   `lastCrawled`. Commit; deploy per `deploy/README.md`.
7. New junk found during review → add a normalized-title prefix to
   `exclusions.json` (global or per-slug) so it never returns.

## Scholar behavior (validated 2026-08)

- **CAPTCHAs are unavoidable and must be clicked by the user** — never by an
  agent. Expect one on the first `/scholar?cites=` query, and occasionally after
  ~10+ queries or on deep pagination (`start>=60`). When one appears, tell the
  user, wait for them to click it, then continue; the Google abuse-exemption
  cookie usually holds for a long run afterwards.
- **Pacing that survived 100+ consecutive pages**: navigate scholar→scholar via
  in-page `location.href=` (keeps the Referer header; tool-driven "typed"
  navigation gets re-flagged much faster), ~13 s between page loads, `num=20`,
  extract ~5 s after navigation.
- **Data quirks**: result titles may carry doubled `[HTML][HTML]`/`[PDF]` badges
  (strip repeatedly); `idp.nature.com|idp.springer.com/authorize/casa` and
  OpenReview links die when their query string is stripped (re-resolve by title
  via Crossref/OpenReview API); Cochrane rows yield year 1996 from the journal
  line; a few rows have no link (Crossref-resolve or drop — the importer requires
  a link); expect occasional pure noise (peer-review files, blogs, metadata
  fragments) → `exclusions.json`.

## Agent playbook (browser-MCP crawl)

Constraints of the agent↔browser channel (as of 2026-08, Claude + Chrome MCP):
tool results truncate near **1 KB**, and outputs containing query-string URLs or
base64 are **blocked**. Therefore: never return raw page data; accumulate in the
tab's `sessionStorage`, diff in-page against what the site already knows, and
read back only the small delta in ≤900-char slices. One tab for the whole crawl
(sessionStorage is per-tab). If the browser connection drops mid-run, reconnect
and read `sbeF`/`sbeD` from sessionStorage to see where you left off.

**Step 0 — known-citation hashes** (server side):

```sh
python3 tools/google-scholar-export/make-known-hashes.py <slug> [...]
```

emits `T <slug> <hashes>` / `L <slug> <hashes>` lines (FNV-1a/32 hex8 of
normalized titles and links of every known citing row).

**Step 1 — per-work setup** (one `javascript_exec` on the crawl tab; `<T>`/`<L>`
from step 0, `<CL>` = clusterIds):

```js
sessionStorage.setItem('sbeH','<T>');sessionStorage.setItem('sbeL','<L>');
sessionStorage.setItem('sbeD','[]');sessionStorage.setItem('sbeF','0');
location.href='https://scholar.google.com/scholar?hl=en&oi=bibs&cites=<CL>&num=20&start=0';'nav'
```

**Step 2 — per-page extract** (run ~5 s after each navigation; between pages
navigate with `location.href=...start=<N+20>` and wait ~13 s):

```js
if (location.pathname.startsWith('/sorry/') || document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, #captcha, form[action*="/sorry/"]') || /unusual traffic/i.test(document.body.textContent)) { throw new Error('ROBOT-CHECK') }
function txt(n){return (n&&n.textContent?n.textContent:'').replace(/\s+/g,' ').trim()}
function norm(v){return String(v||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function fnv(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h.toString(16).padStart(8,'0')}
function yearFrom(v){const m=String(v||'').match(/\b(?:19|20)\d{2}\b/g);return m?Number(m[m.length-1]):null}
function normLink(l){if(!l)return '';return l.replace(/\/+$/,'').toLowerCase()}
const H=sessionStorage.getItem('sbeH')||'';const knownT=new Set();for(let i=0;i<H.length;i+=8)knownT.add(H.slice(i,i+8));
const L=sessionStorage.getItem('sbeL')||'';const knownL=new Set();for(let i=0;i<L.length;i+=8)knownL.add(L.slice(i,i+8));
const D=JSON.parse(sessionStorage.getItem('sbeD')||'[]');
const seen=new Set(D.map(r=>fnv(norm(r.t))));
let stripped=0;
const rows=Array.from(document.querySelectorAll('.gs_r.gs_or.gs_scl')).map(row=>{const tn=row.querySelector('.gs_rt');const a=tn?tn.querySelector('a'):null;let l='';if(a){try{const u=new URL(a.getAttribute('href'),location.href);if(u.search)stripped++;l=u.origin+u.pathname}catch(e){}}return {t:String(txt(tn)).replace(/^(\s*\[[^\]]+\]\s*)+/,'').trim(), l:l, y:yearFrom(txt(row.querySelector('.gs_a')))}}).filter(r=>r.t);
let added=0;
rows.forEach(r=>{const th=fnv(norm(r.t));const lh=r.l?fnv(normLink(r.l)):'';if(!knownT.has(th)&&!seen.has(th)&&!(lh&&knownL.has(lh))){D.push(r);seen.add(th);added++}});
sessionStorage.setItem('sbeD',JSON.stringify(D));
sessionStorage.setItem('sbeF',String(Number(sessionStorage.getItem('sbeF')||'0')+rows.length));
const next=Array.from(document.querySelectorAll('a')).some(a=>/^next$/i.test(a.getAttribute('aria-label')||'')||/^next$/i.test(txt(a))||Boolean(a.querySelector('.gs_ico_nav_next')));
'P|'+rows.length+'|'+added+'|'+D.length+'|'+(next?1:0)+'|'+stripped
```

Output `P|<rows>|<added>|<delta-total>|<hasNext>|<qs-stripped>`. Stop the work
when `hasNext=0`. `norm`/`fnv`/`normLink` here are byte-compatible with
`make-known-hashes.py` — change them only in lockstep.

**Step 3 — delta readout**: read `sessionStorage.getItem('sbeD')` in ≤900-char
slices (`d.slice(0,900)`, `d.slice(900,1800)`, …), reassemble in order, JSON-parse
to validate, save to disk after **every** work. Beware: a slice boundary landing
on a space silently loses that space — verify the reassembled length equals
`d.length` and re-read any short slice.

**Step 4 — build the export** for the importer (`kind: "cited_by_batch"`):

```json
{"schemaVersion":1,"kind":"cited_by_batch","exportedAt":"<iso>",
 "source":"google-scholar-browser",
 "profile":{"userId":"1das_jsAAAAJ","url":"https://scholar.google.com/citations?user=1das_jsAAAAJ&hl=en"},
 "profileWorks":[],
 "works":[{"work":{"title":"<profile row title>"},
            "cited_by":[{"title":"...","link":"https://...","year":2026,"summary":""}]}]}
```

`work.title` must be the **Scholar profile row title** — the importer maps it to
the site publication (aliases for retitled works are hard-coded in
`import-google-scholar-export.mjs`). Then continue at step 3 of the main
procedure. During cleanup, re-resolve dead `casa`/OpenReview/empty links by title
(Crossref `query.bibliographic`, ≥85% token overlap + year sanity; OpenReview
`notes/search`; NCBI idconv for PMC) before importing — `enrich-dois.py` handles
everything that survives with a link.

**Profile scrape** (step 1 of the main procedure), same tab, after loading the
profile URL with `pagesize=100`:

```js
Array.from(document.querySelectorAll('tr.gsc_a_tr')).map(row=>{const a=row.querySelector('.gsc_a_at');const c=row.querySelector('.gsc_a_ac');const cl=(c&&new URL(c.href,location.href).searchParams.get('cites'))||'';return [a&&a.textContent.trim(),(c&&c.textContent.trim())||'0',cl].join('|')}).join('\n')
```

(read in slices if long; returns `title|count|clusterIds` per row — diff counts
against the ledger, and refresh the ledger's clusterIds if Scholar re-clustered).
