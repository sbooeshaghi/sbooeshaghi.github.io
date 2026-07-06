#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");
const publicationsPath = path.join(root, "db", "publications.json");
const overlayPath = path.join(root, "db", "google-scholar-citations.json");
const titleAliases = [
  [
    "Depth normalization for single-cell genomics count data",
    "Normalization for sampled count data"
  ],
  [
    "The impact of genomic variation on function (IGVF) consortium",
    "Deciphering the impact of genomic variation on function"
  ],
  [
    "Quantitative assessment of single-cell RNA-seq clustering with CONCORDEX",
    "Characterization of spatial homogeneous regions in tissues with concordex"
  ],
  [
    "Principles of open source bioinstrumentation applied to the poseidon syringe pump system (vol 9, 12385, 2019)",
    "Principles of open source bioinstrumentation applied to the poseidon syringe pump system"
  ]
];

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function citationKey(record) {
  return [
    normalizeTitle(record.title),
    record.year || "",
    String(record.link || "").trim()
  ].join("|");
}

function minimalRecord(record) {
  return {
    title: String(record.title || "").trim(),
    link: String(record.link || "").trim(),
    year: record.year === null || record.year === undefined || record.year === "" ? null : Number(record.year),
    summary: String(record.summary || "")
  };
}

function usage() {
  console.error(
    "Usage: node tools/google-scholar-export/import-google-scholar-export.mjs [--dry-run] <export.json> [export.json ...]"
  );
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const inputs = args.filter((arg) => arg !== "--dry-run");
if (inputs.length === 0) {
  usage();
  process.exit(1);
}

const publications = readJSON(publicationsPath);
const overlay = readJSON(overlayPath);
if (!overlay.works) overlay.works = {};

const titleToPublication = new Map();
for (const publication of publications) {
  titleToPublication.set(normalizeTitle(publication.title), publication);

  for (const version of publication.versions || []) {
    if (version.title) {
      titleToPublication.set(normalizeTitle(version.title), publication);
    }
  }
}

for (const [aliasTitle, canonicalTitle] of titleAliases) {
  const publication = titleToPublication.get(normalizeTitle(canonicalTitle));
  if (!publication) {
    console.warn(`Title alias target is not a local publication: ${canonicalTitle}`);
    continue;
  }
  titleToPublication.set(normalizeTitle(aliasTitle), publication);
}

let imported = 0;
let skipped = 0;
let profileExports = 0;
let batchExports = 0;

function importCitedByExport(exportData, sourceLabel) {
  const workTitle = exportData.work && exportData.work.title ? exportData.work.title : "";
  const publication = titleToPublication.get(normalizeTitle(workTitle));
  if (!publication) {
    console.warn(`No local publication matched cited-by export work title in ${sourceLabel}: ${workTitle || "(blank)"}`);
    return false;
  }

  const slug = publication.slug || slugify(publication.title);
  if (!overlay.works[slug]) overlay.works[slug] = {};
  if (!Array.isArray(overlay.works[slug].cited_by)) overlay.works[slug].cited_by = [];

  const existing = overlay.works[slug].cited_by;
  const seen = new Set(existing.map(citationKey));
  let addedForWork = 0;

  for (const rawRecord of exportData.cited_by || []) {
    const record = minimalRecord(rawRecord);
    if (!record.title || !record.link) continue;
    const key = citationKey(record);
    if (seen.has(key)) continue;
    existing.push(record);
    seen.add(key);
    imported += 1;
    addedForWork += 1;
  }

  existing.sort((a, b) => {
    const yearDelta = (b.year || 0) - (a.year || 0);
    return yearDelta || String(a.title).localeCompare(String(b.title));
  });

  console.log(`${publication.title}: added ${addedForWork}, total ${existing.length}`);
  return true;
}

for (const input of inputs) {
  const resolved = path.resolve(input);
  const exportData = readJSON(resolved);

  if (exportData.kind === "profile_works") {
    profileExports += 1;
    console.log(`Profile export: ${resolved} (${exportData.works?.length || 0} works)`);
    continue;
  }

  if (exportData.kind === "cited_by") {
    if (!importCitedByExport(exportData, resolved)) skipped += 1;
    continue;
  }

  if (exportData.kind === "cited_by_batch") {
    batchExports += 1;
    console.log(`Batch export: ${resolved} (${exportData.works?.length || 0} works)`);
    for (const workExport of exportData.works || []) {
      const ok = importCitedByExport(
        {
          kind: "cited_by",
          work: workExport.work,
          cited_by: workExport.cited_by || []
        },
        resolved
      );
      if (!ok) skipped += 1;
    }
    continue;
  }

  console.warn(`Skipping unsupported export kind in ${resolved}: ${exportData.kind || "missing"}`);
  skipped += 1;
}

if (imported > 0 && !dryRun) {
  writeJSON(overlayPath, overlay);
} else if (dryRun) {
  console.log("Dry run: no files were changed.");
} else {
  console.log("No new records found; no files were changed.");
}

console.log(
  `Imported ${imported} cited-by records. Skipped ${skipped} entries. Profile exports seen: ${profileExports}. Batch exports seen: ${batchExports}.`
);
