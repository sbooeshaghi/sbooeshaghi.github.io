# Repository Instructions

## Scope

This repository builds and serves `sina.bio`. It contains the website frontend,
a read-only Flask API, and an accepted public scientific-index snapshot. It does
not contain or run the index-generation agent pipeline.

## Required Checks

Before committing application changes, run:

```sh
python3 scripts/build-site-db.py
python3 scripts/stage-site.py
.venv/bin/python -m unittest discover -s tests -v
node --test scripts/lib/object-view.test.mjs scripts/lib/work-relation-view.test.mjs
git diff --check
```

Generated files under `build/` must remain untracked.
Install the Python environment as described in `README.md` before running checks.

## Citation refresh

Google Scholar has no API; cited-by data is collected through a real browser
session (human-run extension or agent-driven browser tooling). To refresh the
citation index, follow `tools/google-scholar-export/REFRESH.md` — it is
self-contained (incremental crawl ledger, importer exclusions, DOI enrichment,
and a validated agent playbook). Do not scrape Scholar from the server.

## Deployment

Follow `deploy/README.md`. The production contract is:

- Docker serves the application only on host loopback port `8780` by default.
- Apache owns the public ports, TLS certificates, and domain routing.
- Deploy `db/resource-index.json`; do not regenerate the scientific index on the
  web server.
- Build and health-check the new image before changing Apache.
- Inspect and preserve existing Apache virtual hosts and Certbot directives.
- Do not modify unrelated sites running on the same host.
- Keep a known-good Git commit available for rollback.

## Public Repository Policy

This repository is public. Never commit:

- passwords, tokens, private keys, cookies, or `.env` files;
- server IP addresses, SSH usernames, or private host inventory;
- Certbot account data or private certificate material;
- local papers, extracted text, private provenance paths, or generated SQLite
  databases.

Public domain names, public identifiers, and generic configuration examples are
permitted. Supply machine-specific deployment context to an agent out of band.
