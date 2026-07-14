#!/usr/bin/env python3
"""Stage only public website assets for the production image."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


ROOT_FILES = [
    "404.html",
    "blog.html",
    "index.html",
    "links.html",
    "object-page.js",
    "object.html",
    "publications.html",
    "script.js",
    "styles.css",
    "work-relations.js",
]
PUBLIC_DIRECTORIES = ["img", "posts", "tools", "works"]
PUBLIC_DATABASE_FILES = [
    "cited-by.json",
    "links.json",
    "publication-authors.json",
    "publications.json",
    "quotes.json",
]


def copy_site(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for name in ROOT_FILES:
        shutil.copy2(source / name, destination / name)
    for name in PUBLIC_DIRECTORIES:
        shutil.copytree(source / name, destination / name, dirs_exist_ok=True)
    database_directory = destination / "db"
    database_directory.mkdir(exist_ok=True)
    for name in PUBLIC_DATABASE_FILES:
        shutil.copy2(source / "db" / name, database_directory / name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("build/site"))
    args = parser.parse_args()
    copy_site(args.source.resolve(), args.output.resolve())
    print(f"Staged public website assets in {args.output}.")


if __name__ == "__main__":
    main()
