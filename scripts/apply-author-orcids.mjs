import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationAuthorsPath = path.join(
  rootDir,
  "db",
  "publication-authors.json"
);
const authorOrcidsPath = path.join(rootDir, "db", "author-orcids.json");

const publications = JSON.parse(fs.readFileSync(publicationAuthorsPath, "utf8"));
const overlay = JSON.parse(fs.readFileSync(authorOrcidsPath, "utf8"));
const byName = new Map();

for (const author of overlay.authors || []) {
  const key = normalizeName(author.name);
  const orcid = normalizeOrcid(author.orcid);

  if (!key || key !== author.normalizedName || !orcid) {
    throw new Error(`Invalid author ORCID override: ${author.name || "<unnamed>"}`);
  }
  if (byName.has(key) && byName.get(key) !== orcid) {
    throw new Error(`Conflicting author ORCID overrides for ${author.name}`);
  }
  byName.set(key, orcid);
}

let applied = 0;
for (const work of Object.values(publications.works || {})) {
  for (const version of work.versions || []) {
    for (const author of version.authors || []) {
      const orcid = byName.get(normalizeName(author.name));
      if (!orcid) continue;
      if (author.orcid && normalizeOrcid(author.orcid) !== orcid) {
        throw new Error(`Author ORCID override conflicts for ${author.name}`);
      }
      if (!author.orcid) applied += 1;
      author.orcid = `https://orcid.org/${orcid}`;
    }
  }
}

const source = "Authorlink unique exact-name ORCID overrides";
if (!publications.sources.includes(source)) {
  publications.sources.push(source);
}
publications.orcidEnrichedAt = overlay.generatedAt;

fs.writeFileSync(
  publicationAuthorsPath,
  `${JSON.stringify(publications, null, 2)}\n`
);
console.log(`Applied ORCID overrides to ${applied} author records.`);

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeOrcid(value) {
  const match = String(value || "").match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/i);
  return match ? match[0].toUpperCase() : "";
}
