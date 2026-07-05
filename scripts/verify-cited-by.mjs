import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationsPath = path.join(rootDir, "db", "publications.json");
const citationsPath = path.join(rootDir, "db", "citations.json");
const googleScholarCitationsPath = path.join(
  rootDir,
  "db",
  "google-scholar-citations.json"
);
const citedByPath = path.join(rootDir, "db", "cited-by.json");
const worksDir = path.join(rootDir, "works");
const allowedRowKeys = new Set(["title", "link", "year", "summary"]);

const publications = JSON.parse(fs.readFileSync(publicationsPath, "utf8"));
const citationData = fs.existsSync(citationsPath)
  ? JSON.parse(fs.readFileSync(citationsPath, "utf8"))
  : { works: {} };
const googleScholarCitationData = fs.existsSync(googleScholarCitationsPath)
  ? JSON.parse(fs.readFileSync(googleScholarCitationsPath, "utf8"))
  : { works: {} };
const citedBy = JSON.parse(fs.readFileSync(citedByPath, "utf8"));
const errors = [];

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function citationTraceKey(row) {
  const title = String(row.title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return `${title}:${row.year || ""}`;
}

function sourceCitationKeys(slug) {
  const keys = new Set();

  for (const row of citationData.works?.[slug]?.citations || []) {
    keys.add(citationTraceKey(row));
  }

  for (const row of googleScholarCitationData.works?.[slug]?.cited_by || []) {
    keys.add(citationTraceKey(row));
  }

  return keys;
}

function htmlCitationCount(slug) {
  const pagePath = path.join(worksDir, `${slug}.html`);

  if (!fs.existsSync(pagePath)) {
    errors.push(`${slug}: missing work page`);
    return null;
  }

  const html = fs.readFileSync(pagePath, "utf8");
  const match = html.match(/<p class="citation-source-note">\s*(\d+) citing work/);

  if (!match) {
    errors.push(`${slug}: missing citation count in generated page`);
    return null;
  }

  return Number(match[1]);
}

for (const publication of publications) {
  const slug = slugify(publication.title);
  const work = citedBy.works?.[slug];

  if (!work) {
    errors.push(`${slug}: missing cited_by data`);
    continue;
  }

  const rows = work.cited_by || [];
  const renderedCount = htmlCitationCount(slug);
  const sourceKeys = sourceCitationKeys(slug);
  const hasApiSource = Boolean(citationData.works?.[slug]);
  const hasGoogleScholarSource = Boolean(googleScholarCitationData.works?.[slug]);

  if (!hasApiSource && !hasGoogleScholarSource) {
    errors.push(`${slug}: missing citation source data`);
  }

  if (renderedCount !== null && renderedCount !== rows.length) {
    errors.push(`${slug}: rendered ${renderedCount} rows, expected ${rows.length}`);
  }

  for (const [index, row] of rows.entries()) {
    const keys = Object.keys(row);
    const extraKeys = keys.filter((key) => !allowedRowKeys.has(key));
    const missingKeys = [...allowedRowKeys].filter((key) => !(key in row));

    if (extraKeys.length) {
      errors.push(`${slug}[${index}]: extra keys ${extraKeys.join(", ")}`);
    }

    if (missingKeys.length) {
      errors.push(`${slug}[${index}]: missing keys ${missingKeys.join(", ")}`);
    }

    if (!row.title) {
      errors.push(`${slug}[${index}]: missing title`);
    }

    if (!row.link) {
      errors.push(`${slug}[${index}]: missing link`);
    }

    if (row.link && !/^https?:\/\//.test(row.link)) {
      errors.push(`${slug}[${index}]: non-http link ${row.link}`);
    }

    if (
      row.summary &&
      (/confirms? this work cites the linked work/i.test(row.summary) ||
        /google scholar lists this work/i.test(row.summary))
    ) {
      errors.push(`${slug}[${index}]: placeholder summary`);
    }

    if (!sourceKeys.has(citationTraceKey(row))) {
      errors.push(`${slug}[${index}]: row does not trace to API or Google Scholar source data`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const rows = Object.values(citedBy.works).reduce(
  (sum, work) => sum + (work.cited_by || []).length,
  0
);
console.log(
  `Verified ${publications.length} works, ${rows} cited_by rows, generated page counts, and source traces.`
);
