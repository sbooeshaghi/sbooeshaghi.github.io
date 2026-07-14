# sina.bio

Personal website and scientific-index interface. The repository contains a static
frontend and a small read-only website backend. It does not run the scientific
indexing or agent pipeline.

## Runtime boundary

`db/resource-index.json` is the accepted public graph snapshot. The Docker build
converts it into a site-specific SQLite database, stages public frontend assets,
and packages both with the website API. Local papers, extracted text, and index
generation tools are not part of the image.

## Local development

Python 3.13 is required.

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python scripts/build-site-db.py
SITE_ROOT=. SITE_DATABASE=build/site-index.sqlite \
  .venv/bin/gunicorn --bind 127.0.0.1:8770 backend.app:app
```

Run tests with:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

## Docker deployment

The container publishes only to the host loopback interface. Apache remains the
public TLS endpoint and reverse proxies `sina.bio` to that private port.

```sh
git clone https://github.com/sbooeshaghi/sbooeshaghi.github.io.git
cd sbooeshaghi.github.io
docker compose up --build -d
curl --fail http://127.0.0.1:8780/healthz
```

Enable the required Apache modules once:

```sh
sudo a2enmod proxy proxy_http headers ssl
sudo systemctl reload apache2
```

Adapt `deploy/apache/sina.bio.conf.example` to the existing Certbot-managed TLS
virtual host, enable it, verify the configuration, and reload Apache:

```sh
sudo apache2ctl configtest
sudo systemctl reload apache2
```

To deploy an update:

```sh
git pull --ff-only
docker compose up --build -d
curl --fail http://127.0.0.1:8780/healthz
```

The accepted graph snapshot is deployed, not regenerated, on the web server.
