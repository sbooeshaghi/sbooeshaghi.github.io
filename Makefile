.PHONY: site-db stage test serve

site-db:
	python3 scripts/build-site-db.py

stage: site-db
	python3 scripts/stage-site.py

test:
	python3 -m unittest discover -s tests -v

serve: site-db
	SITE_ROOT=. SITE_DATABASE=build/site-index.sqlite gunicorn --bind 127.0.0.1:8770 backend.app:app
