#!/usr/bin/env python3
"""Emit per-work hash strings for the browser-side cited-by diff.

For each work slug in db/cited-by.json, prints concatenated FNV-1a/32 hex8
hashes of every known citing row's normalized title (line "T <slug> <hashes>")
and normalized link (line "L <slug> <hashes>"). Inject these into the crawl
tab's sessionStorage (sbeH / sbeL) so the in-page extractor only accumulates
citations the site does not already know.

The normalization and hash here MUST stay byte-compatible with the JS
`norm()` / `fnv()` / `normLink()` functions in REFRESH.md.
"""
import json, os, re, sys, unicodedata
from urllib.parse import urlsplit

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def norm_title(v):
    v = unicodedata.normalize("NFKD", str(v or ""))
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = v.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", v).strip()


def norm_link(v):
    try:
        u = urlsplit(str(v or "").strip())
        if not u.netloc:
            return ""
        return f"{u.scheme}://{u.netloc}{u.path.rstrip('/')}".lower()
    except ValueError:
        return ""


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def main():
    cited = json.load(open(os.path.join(ROOT, "db", "cited-by.json")))
    only = sys.argv[1:]  # optional slug filter
    for slug, work in sorted(cited["works"].items()):
        if only and slug not in only:
            continue
        titles, links = set(), set()
        for row in work.get("cited_by", []):
            titles.add(fnv1a(norm_title(row.get("title"))))
            nl = norm_link(row.get("link"))
            if nl:
                links.add(fnv1a(nl))
        print(f"T {slug} {''.join(sorted(titles))}")
        print(f"L {slug} {''.join(sorted(links))}")


if __name__ == "__main__":
    main()
