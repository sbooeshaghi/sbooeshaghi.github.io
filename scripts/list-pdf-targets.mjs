import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationsPath = path.join(rootDir, "db", "publications.json");
const citedByPath = path.join(rootDir, "db", "cited-by.json");

const args = new Set(process.argv.slice(2));
const scopeArg = [...args].find((arg) => arg.startsWith("--scope="));
const scope = scopeArg ? scopeArg.split("=")[1] : "works";
const asJSON = args.has("--json");
const mkdir = args.has("--mkdir");
const missingOnly = args.has("--missing");
const quiet = args.has("--quiet");

if (!["works", "cited-by", "all"].includes(scope)) {
  console.error("Usage: node scripts/list-pdf-targets.mjs [--scope=works|cited-by|all] [--json] [--mkdir] [--missing] [--quiet]");
  process.exit(1);
}

function readJSON(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableSlug(value, maxLength = 96) {
  const slug = slugify(value) || "untitled";

  if (slug.length <= maxLength) return slug;

  const hash = createHash("sha1").update(slug).digest("hex").slice(0, 10);
  return `${slug.slice(0, maxLength - hash.length - 1).replace(/-+$/g, "")}-${hash}`;
}

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function versionSlug(version, index) {
  return (
    slugify([version.date, version.name].filter(Boolean).join(" ")) ||
    `version-${index + 1}`
  );
}

function versionId(workSlug, version, index) {
  return `${workSlug}--${versionSlug(version, index)}`;
}

function publicationVersions(publication) {
  const versions = publication.versions?.length
    ? publication.versions
    : publication.links || [];
  return [...versions].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
}

function targetExists(target) {
  return fs.existsSync(path.join(rootDir, target.pdf_path));
}

function maybeCreateDirs(target) {
  fs.mkdirSync(path.dirname(path.join(rootDir, target.pdf_path)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(rootDir, target.text_path)), { recursive: true });
}

function workTargets() {
  const publications = readJSON(publicationsPath, []);

  return publications.flatMap((publication) => {
    const workSlug = slugify(publication.title);

    return publicationVersions(publication).map((version, index) => {
      const shortVersion = versionSlug(version, index);

      return {
        kind: "source_work_version",
        work_slug: workSlug,
        version_id: versionId(workSlug, version, index),
        title: version.title || publication.title,
        source: version.name || "",
        date: version.date || "",
        source_url: version.url || version.doi || "",
        pdf_path: `local/papers/works/${workSlug}/${shortVersion}.pdf`,
        text_path: `local/extracts/works/${workSlug}/${shortVersion}.txt`
      };
    });
  });
}

function citedByTargets() {
  const citedByData = readJSON(citedByPath, { works: {} });
  const seen = new Map();

  for (const [workSlug, work] of Object.entries(citedByData.works || {})) {
    for (const citation of work.cited_by || []) {
      const key = [
        normalizeTitle(citation.title),
        citation.year || "",
        String(citation.link || "").trim()
      ].join("|");

      if (!seen.has(key)) {
        const citedBySlug = stableSlug(
          [citation.year, citation.title].filter(Boolean).join(" ")
        );
        seen.set(key, {
          kind: "cited_by_work",
          cited_by_id: `cited-by--${citedBySlug}`,
          title: citation.title || "",
          year: citation.year || null,
          source_url: citation.link || "",
          cites_work_slugs: [],
          pdf_path: `local/papers/cited-by/${citedBySlug}.pdf`,
          text_path: `local/extracts/cited-by/${citedBySlug}.txt`
        });
      }

      const target = seen.get(key);
      if (!target.cites_work_slugs.includes(workSlug)) {
        target.cites_work_slugs.push(workSlug);
      }
    }
  }

  return [...seen.values()].sort((a, b) => {
    const yearComparison = (b.year || 0) - (a.year || 0);
    if (yearComparison) return yearComparison;
    return a.title.localeCompare(b.title);
  });
}

let targets = [];
if (scope === "works" || scope === "all") targets = targets.concat(workTargets());
if (scope === "cited-by" || scope === "all") targets = targets.concat(citedByTargets());
if (missingOnly) targets = targets.filter((target) => !targetExists(target));
if (mkdir) targets.forEach(maybeCreateDirs);

if (quiet) {
  console.error(`Prepared ${targets.length} PDF target${targets.length === 1 ? "" : "s"}.`);
} else if (asJSON) {
  console.log(JSON.stringify({ schema_version: 1, targets }, null, 2));
} else {
  console.log(["kind", "id", "title", "source", "date", "source_url", "pdf_path"].join("\t"));
  for (const target of targets) {
    console.log([
      target.kind,
      target.version_id || target.cited_by_id,
      target.title,
      target.source || "",
      target.date || target.year || "",
      target.source_url,
      target.pdf_path
    ].join("\t"));
  }
}
