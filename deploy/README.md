# Deployment

This runbook deploys the public repository to an Ubuntu host where Apache already
serves one or more websites. Docker runs `sina.bio` privately; Apache remains the
only public web server.

Machine-specific details such as the host address, SSH account, existing virtual
host paths, and credentials must be supplied out of band.

## 1. Inspect the Host

Do not change the host until these commands succeed and the existing Apache
layout is understood:

```sh
docker --version
docker compose version
sudo apache2ctl -S
sudo apache2ctl configtest
sudo systemctl status apache2 --no-pager
sudo ss -ltnp
```

Confirm that loopback port `8780` is available. If it is occupied, choose another
loopback port in a local, untracked `.env` file:

```text
SINA_BIO_PORT=8781
```

Do not expose this port through a public interface or firewall rule.

## 2. Prepare the Checkout

For a new checkout:

```sh
git clone https://github.com/sbooeshaghi/sbooeshaghi.github.io.git
cd sbooeshaghi.github.io
```

For an existing clean checkout:

```sh
git switch main
git status --short
git pull --ff-only
git rev-parse HEAD
```

Record the current commit before updating an existing deployment. Stop if the
checkout contains unexplained changes.

## 3. Build and Start

Build first so a failed build does not replace the running container:

```sh
docker compose config --quiet
docker compose build --pull
docker compose up --detach --no-build --wait --wait-timeout 60
docker compose ps
curl --fail http://127.0.0.1:8780/healthz
```

If the container or health check fails, leave Apache unchanged and inspect the
service logs:

```sh
docker compose logs --tail=200 website
```

If `SINA_BIO_PORT` was changed, use that port in all local checks and Apache
directives. Verify representative routes before touching Apache:

```sh
curl --fail http://127.0.0.1:8780/
curl --fail http://127.0.0.1:8780/author/a-sina-booeshaghi
curl --fail http://127.0.0.1:8780/work/a-machine-readable-specification-for-genomics-assays
```

## 4. Connect Apache

Enable the required modules once:

```sh
sudo a2enmod proxy proxy_http headers ssl
```

Inspect the active `sina.bio` virtual host. Merge the proxy directives from
`deploy/apache/sina.bio.conf.example` into that configuration; do not overwrite
existing Certbot-managed TLS directives or unrelated virtual hosts.

Validate before reloading:

```sh
sudo apache2ctl configtest
sudo systemctl reload apache2
curl --fail https://sina.bio/healthz
curl --fail https://sina.bio/author/a-sina-booeshaghi
```

Use `reload`, not `restart`, unless a restart is independently required.

## 5. Update

Repeat the clean-checkout, build, start, and health-check steps. Apache normally
requires no change for application-only updates.

## Rollback

Switch to the previously recorded known-good commit and rebuild:

```sh
git switch --detach <known-good-commit>
docker compose build
docker compose up --detach --no-build --wait --wait-timeout 60
curl --fail http://127.0.0.1:8780/healthz
```

After the incident is resolved, return the checkout to `main` before the next
deployment:

```sh
git switch main
git pull --ff-only
```

Do not delete the checkout, Docker data, Apache configuration, or certificates as
part of rollback.
