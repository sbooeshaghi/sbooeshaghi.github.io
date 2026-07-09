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
const publicationAuthorsPath = path.join(
  rootDir,
  "db",
  "publication-authors.json"
);
const worksDir = path.join(rootDir, "works");
const allowedRowKeys = new Set([
  "title",
  "link",
  "year",
  "summary",
  "citation_context",
]);
const requiredRowKeys = new Set(["title", "link", "year", "summary"]);
const allowedAuthorVersionKeys = new Set(["name", "doi", "date", "authors"]);
const allowedAuthorKeys = new Set(["name", "orcid"]);

const publications = JSON.parse(fs.readFileSync(publicationsPath, "utf8"));
const citationData = fs.existsSync(citationsPath)
  ? JSON.parse(fs.readFileSync(citationsPath, "utf8"))
  : { works: {} };
const googleScholarCitationData = fs.existsSync(googleScholarCitationsPath)
  ? JSON.parse(fs.readFileSync(googleScholarCitationsPath, "utf8"))
  : { works: {} };
const citedBy = JSON.parse(fs.readFileSync(citedByPath, "utf8"));
const publicationAuthors = JSON.parse(
  fs.readFileSync(publicationAuthorsPath, "utf8")
);
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

function verifyCitationContext(slug, index, context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    errors.push(`${slug}[${index}].citation_context: must be object`);
    return;
  }

  if (!context.paper_summary) {
    errors.push(`${slug}[${index}].citation_context: missing paper_summary`);
  }

  if (!Array.isArray(context.uses) || !context.uses.length) {
    errors.push(`${slug}[${index}].citation_context: missing uses`);
    return;
  }

  for (const [useIndex, use] of context.uses.entries()) {
    if (!use.statement) {
      errors.push(
        `${slug}[${index}].citation_context.uses[${useIndex}]: missing statement`
      );
    }

    if (!Array.isArray(use.evidence) || !use.evidence.length) {
      errors.push(
        `${slug}[${index}].citation_context.uses[${useIndex}]: missing evidence`
      );
    }
  }
}

function htmlCitationCount(slug) {
  const pagePath = path.join(worksDir, `${slug}.html`);

  if (!fs.existsSync(pagePath)) {
    errors.push(`${slug}: missing work page`);
    return null;
  }

  const html = fs.readFileSync(pagePath, "utf8");
  const match = html.match(/<dt>Citations<\/dt>\s*<dd>(\d+)<\/dd>/);

  if (!match) {
    errors.push(`${slug}: missing citation count in generated page`);
    return null;
  }

  return Number(match[1]);
}

for (const publication of publications) {
  const slug = slugify(publication.title);
  const work = citedBy.works?.[slug];
  const authorWork = publicationAuthors.works?.[slug];

  if (!work) {
    errors.push(`${slug}: missing cited_by data`);
    continue;
  }

  if (!authorWork) {
    errors.push(`${slug}: missing author data`);
    continue;
  }

  const rows = work.cited_by || [];
  const authorVersions = authorWork.versions || [];
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

  if (authorVersions.length !== (publication.links || []).length) {
    errors.push(
      `${slug}: ${authorVersions.length} author versions, expected ${
        (publication.links || []).length
      } publication links`
    );
  }

  for (const [versionIndex, version] of authorVersions.entries()) {
    const versionKeys = Object.keys(version);
    const extraVersionKeys = versionKeys.filter(
      (key) => !allowedAuthorVersionKeys.has(key)
    );
    const missingVersionKeys = [...allowedAuthorVersionKeys].filter(
      (key) => !(key in version)
    );

    if (extraVersionKeys.length) {
      errors.push(
        `${slug}.versions[${versionIndex}]: extra keys ${extraVersionKeys.join(", ")}`
      );
    }

    if (missingVersionKeys.length) {
      errors.push(
        `${slug}.versions[${versionIndex}]: missing keys ${missingVersionKeys.join(", ")}`
      );
    }

    if (!version.name) {
      errors.push(`${slug}.versions[${versionIndex}]: missing name`);
    }

    if (!version.doi) {
      errors.push(`${slug}.versions[${versionIndex}]: missing doi`);
    }

    if (!Array.isArray(version.authors) || !version.authors.length) {
      errors.push(`${slug}.versions[${versionIndex}]: missing authors`);
      continue;
    }

    for (const [authorIndex, author] of version.authors.entries()) {
      const authorKeys = Object.keys(author);
      const extraAuthorKeys = authorKeys.filter((key) => !allowedAuthorKeys.has(key));

      if (extraAuthorKeys.length) {
        errors.push(
          `${slug}.versions[${versionIndex}].authors[${authorIndex}]: extra keys ${extraAuthorKeys.join(", ")}`
        );
      }

      if (!author.name) {
        errors.push(
          `${slug}.versions[${versionIndex}].authors[${authorIndex}]: missing name`
        );
      }

      if (
        author.orcid &&
        !/^https:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(author.orcid)
      ) {
        errors.push(
          `${slug}.versions[${versionIndex}].authors[${authorIndex}]: invalid ORCID ${author.orcid}`
        );
      }
    }
  }

  for (const [index, row] of rows.entries()) {
    const keys = Object.keys(row);
    const extraKeys = keys.filter((key) => !allowedRowKeys.has(key));
    const missingKeys = [...requiredRowKeys].filter((key) => !(key in row));

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

    if (row.citation_context) {
      verifyCitationContext(slug, index, row.citation_context);
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
  `Verified ${publications.length} works, ${rows} cited_by rows, versioned authors, generated page counts, and source traces.`
);
