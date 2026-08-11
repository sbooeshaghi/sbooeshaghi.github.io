#!/usr/bin/env python3
"""Rewrite db/google-scholar-citations.json cited_by links to https://doi.org/ form where
resolvable (URL-embedded DOI, PMC id conversion, arXiv id, Crossref title match).
Links without a resolvable DOI are left untouched. Run after the importer, before
scripts/rebuild-citations.mjs. Idempotent."""
import json, re, time, unicodedata, urllib.parse, urllib.request

import os
OVERLAY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "db", "google-scholar-citations.json")
MAILTO = "sbooeshaghi@gmail.com"
DOI_RE = r"(10\.\d{4,9}/[^\s?#]+)"

def norm_title(v):
    v = unicodedata.normalize("NFKD", str(v or ""))
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = v.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", v).strip()

def clean_doi(doi):
    doi = urllib.parse.unquote(doi).rstrip("/.")
    for suf in (".abstract", ".full.pdf", ".full", ".pdf", "/full", "_reference"):
        if doi.endswith(suf):
            doi = doi[: -len(suf)]
    doi = re.sub(r"v\d+$", "", doi)  # biorxiv version suffix
    return doi.lower()

def doi_from_url(link):
    u = urllib.parse.urlsplit(link)
    host, path = u.netloc.lower(), u.path
    # nature.com/articles/<id> -> 10.1038/<id>
    m = re.match(r"^/articles/([a-z0-9.-]+)$", path)
    if host.endswith("nature.com") and m:
        return "10.1038/" + m.group(1).lower()
    # elifesciences.org/articles/58716 -> 10.7554/eLife.58716
    m = re.match(r"^/articles/(\d+)$", path)
    if host.endswith("elifesciences.org") and m:
        return f"10.7554/elife.{m.group(1)}"
    # academic.oup.com .../doi/<doi-with-slashes>/<numid>[/...] or plain /doi/
    if host.endswith("academic.oup.com") and "/doi/" in path:
        tail = path.split("/doi/", 1)[1]
        m = re.match(DOI_RE, tail)
        if m:
            doi = m.group(1)
            doi = re.sub(r"/\d{6,}(/.*)?$", "", doi)  # strip trailing article ids
            return clean_doi(doi)
    # generic: embedded 10.xxxx/ DOI in path for known DOI-in-path hosts
    doi_hosts = ("biorxiv.org", "medrxiv.org", "link.springer.com", "onlinelibrary.wiley.com",
                 "currentprotocols.onlinelibrary.wiley.com", "bpspubs.onlinelibrary.wiley.com",
                 "advanced.onlinelibrary.wiley.com", "www.science.org", "spj.science.org",
                 "journals.asm.org", "dl.acm.org", "www.tandfonline.com", "www.cochranelibrary.com",
                 "journals.sagepub.com", "www.liebertpub.com", "www.frontiersin.org",
                 "journals.plos.org", "www.sciengine.com", "apsjournals.apsnet.org",
                 "asmedigitalcollection.asme.org", "www.inderscienceonline.com", "journals.iucr.org")
    if any(host == h or host.endswith("." + h) or h.endswith(host) for h in doi_hosts):
        m = re.search(DOI_RE, path)
        if m:
            return clean_doi(m.group(1))
    return None

def pmc_to_doi(link, cache={}):
    m = re.search(r"/articles/(PMC\d+)", link)
    if not m:
        return None
    pmcid = m.group(1)
    if pmcid in cache:
        return cache[pmcid]
    url = f"https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids={pmcid}&format=json&tool=sinabio&email={MAILTO}"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            rec = json.load(r)["records"][0]
        doi = rec.get("doi")
    except Exception:
        doi = None
    cache[pmcid] = doi.lower() if doi else None
    time.sleep(0.5)
    return cache[pmcid]

CROSSREF_HOSTS = ("www.sciencedirect.com", "www.cell.com", "ieeexplore.ieee.org", "www.mdpi.com",
                  "pubs.rsc.org", "jamanetwork.com", "www.researchsquare.com",
                  "wellcomeopenresearch.org", "sciexplor.com", "publikasi.teknokrat.ac.id",
                  "ph.pollub.pl", "arxiv.org")

def crossref_doi(title, year, cache={}):
    key = norm_title(title)
    if key in cache:
        return cache[key]
    q = urllib.parse.quote(title[:250])
    url = f"https://api.crossref.org/works?query.bibliographic={q}&rows=2&mailto={MAILTO}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": f"sina.bio-citations (mailto:{MAILTO})"}), timeout=20) as r:
            items = json.load(r)["message"]["items"]
    except Exception:
        items = []
    out = None
    tn = norm_title(title)
    for it in items:
        cand = norm_title((it.get("title") or [""])[0])
        if not cand:
            continue
        a, b = set(tn.split()), set(cand.split())
        if not a or not b or len(a & b) / max(len(a), len(b)) < 0.85:
            continue
        cy = None
        for k in ("published-print", "published-online", "issued"):
            dp = it.get(k, {}).get("date-parts", [[None]])
            if dp and dp[0] and dp[0][0]:
                cy = dp[0][0]
                break
        if year and cy and abs(int(year) - int(cy)) > 2:
            continue
        out = it.get("DOI", "").lower() or None
        break
    cache[key] = out
    time.sleep(1.1)
    return out

def main():
    data = json.load(open(OVERLAY))
    stats = {"already_doi": 0, "url_extract": 0, "pmc": 0, "crossref": 0, "arxiv": 0, "kept_asis": 0}
    changes = []
    for slug, w in data["works"].items():
        for row in w.get("cited_by", []):
            link = row.get("link", "")
            if not link or "doi.org/" in link:
                stats["already_doi"] += 1
                continue
            host = urllib.parse.urlsplit(link).netloc.lower()
            doi = doi_from_url(link)
            how = "url_extract"
            if not doi and "pmc.ncbi.nlm.nih.gov" in host:
                doi = pmc_to_doi(link)
                how = "pmc"
            if not doi and host == "arxiv.org":
                m = re.search(r"/abs/(\d{4}\.\d{4,5})", link)
                if m:
                    doi = f"10.48550/arxiv.{m.group(1)}"
                    how = "arxiv"
            if not doi and (host in CROSSREF_HOSTS):
                doi = crossref_doi(row.get("title", ""), row.get("year"))
                how = "crossref"
            if doi:
                new = "https://doi.org/" + doi
                changes.append((slug, row["title"][:60], link, new))
                row["link"] = new
                stats[how] += 1
            else:
                stats["kept_asis"] += 1
    json.dump(data, open(OVERLAY, "w"), ensure_ascii=False, indent=2)
    # match importer writeJSON style (2-space indent + trailing newline)
    with open(OVERLAY, "a") as f:
        f.write("\n")
    print(stats)
    print("total rewritten:", len(changes))

if __name__ == "__main__":
    main()
