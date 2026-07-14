FROM python:3.13-slim AS builder

WORKDIR /source
COPY . .
RUN python scripts/build-site-db.py --output /artifacts/site-index.sqlite \
    && python scripts/stage-site.py --output /artifacts/site

FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    SITE_ROOT=/app/site \
    SITE_DATABASE=/app/data/site-index.sqlite

WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend /app/backend
COPY --from=builder /artifacts/site /app/site
COPY --from=builder /artifacts/site-index.sqlite /app/data/site-index.sqlite

USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)" || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--access-logfile", "-", "--error-logfile", "-", "backend.app:app"]
