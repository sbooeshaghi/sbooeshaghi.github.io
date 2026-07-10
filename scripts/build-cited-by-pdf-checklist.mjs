import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationsPath = path.join(rootDir, "db", "publications.json");
const citedByPath = path.join(rootDir, "db", "cited-by.json");
const pdfManifestPath = path.join(rootDir, "db", "pdf-manifest.local.json");
const outputDir = path.join(rootDir, "local", "citation-context");
const jsonOutputPath = path.join(outputDir, "cited-by-pdf-checklist.local.json");
const mdOutputPath = path.join(outputDir, "cited-by-pdf-checklist.local.md");
const missingMdOutputPath = path.join(outputDir, "cited-by-pdf-missing.local.md");
const missingCsvOutputPath = path.join(outputDir, "cited-by-pdf-missing.local.csv");

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

function sourceKind(url) {
  const value = String(url || "");
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(value)) return "doi";
  if (/biorxiv\.org|medrxiv\.org/i.test(value)) return "preprint";
  if (/pubmed|pmc\.ncbi|nih\.gov/i.test(value)) return "pubmed";
  if (/scholar\.google/i.test(value)) return "google_scholar";
  if (/search\.proquest/i.test(value)) return "proquest";
  if (/^https?:\/\//i.test(value)) return "url";
  return "unknown";
}

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/$/, "")
    .toLowerCase();
}

function normalizeDoiish(value) {
  return normalizeUrl(value)
    .replace(/^https:\/\/(?:dx\.)?doi\.org\//, "doi:")
    .replace(/^doi:/, "doi:")
    .replace(/\?versioned=true$/, "");
}

function sourceWorkPDFsByURL() {
  const manifest = readJSON(pdfManifestPath, { source_work_versions: [] });
  const byURL = new Map();

  for (const version of manifest.source_work_versions || []) {
    for (const key of [
      normalizeUrl(version.version_url),
      normalizeDoiish(version.version_url),
    ]) {
      if (key) {
        byURL.set(key, {
          paper: version.version_id,
          work_slug: version.work_slug,
          pdf_path: version.pdf?.path || "",
        });
      }
    }
  }

  return byURL;
}

function targetExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function markdownLink(label, url) {
  if (!url) return label;
  return `[${label}](${url})`;
}

function checkbox(item) {
  const checked = item.pdf_status === "missing" ? " " : "x";
  const title = markdownLink(item.title.replace(/\]/g, "\\]"), item.source_url);
  const cites = item.cites
    .map((work) => work.title)
    .join("; ")
    .replace(/\n/g, " ");
  const pdfPath = item.available_pdf_path || item.pdf_path;
  return `- [${checked}] ${title} (${item.year || "n.d."}) — cites ${item.cites.length}: ${cites}  \n  PDF: \`${pdfPath}\``;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

const publications = readJSON(publicationsPath, []);
const citedByData = readJSON(citedByPath, { works: {} });
const sourcePDFByURL = sourceWorkPDFsByURL();
const publicationTitlesBySlug = new Map(
  publications.map((publication) => [slugify(publication.title), publication.title])
);
const seen = new Map();
let citationRows = 0;

for (const [workSlug, work] of Object.entries(citedByData.works || {})) {
  for (const citation of work.cited_by || []) {
    citationRows += 1;
    const key = [
      normalizeTitle(citation.title),
      citation.year || "",
      String(citation.link || "").trim(),
    ].join("|");

    if (!seen.has(key)) {
      const storage_slug_base = stableSlug(
        [citation.year, citation.title].filter(Boolean).join(" ")
      );
      seen.set(key, {
        id: `cited-by--${storage_slug_base}`,
        title: citation.title || "",
        year: citation.year || null,
        source_url: citation.link || "",
        source_kind: sourceKind(citation.link),
        storage_slug_base,
        source_hash: createHash("sha1").update(key).digest("hex").slice(0, 10),
        cites: [],
      });
    }

    const item = seen.get(key);
    if (!item.cites.some((entry) => entry.work_slug === workSlug)) {
      item.cites.push({
        work_slug: workSlug,
        title: work.title || publicationTitlesBySlug.get(workSlug) || workSlug,
      });
    }
  }
}

const items = [...seen.values()].sort((a, b) => {
  const citeCountComparison = b.cites.length - a.cites.length;
  if (citeCountComparison) return citeCountComparison;
  const yearComparison = (b.year || 0) - (a.year || 0);
  if (yearComparison) return yearComparison;
  return a.title.localeCompare(b.title);
});

const baseSlugCounts = new Map();
for (const item of items) {
  baseSlugCounts.set(
    item.storage_slug_base,
    (baseSlugCounts.get(item.storage_slug_base) || 0) + 1
  );
}

for (const item of items) {
  const storageSlug =
    baseSlugCounts.get(item.storage_slug_base) > 1
      ? stableSlug(`${item.storage_slug_base}-${item.source_hash}`, 110)
      : item.storage_slug_base;
  item.id = `cited-by--${storageSlug}`;
  item.pdf_path = `local/papers/cited-by/${storageSlug}.pdf`;
  item.text_path = `local/extracts/cited-by/${storageSlug}.txt`;
  item.source_work_pdf =
    sourcePDFByURL.get(normalizeUrl(item.source_url)) ||
    sourcePDFByURL.get(normalizeDoiish(item.source_url)) ||
    null;

  if (targetExists(item.pdf_path)) {
    item.pdf_status = "present";
    item.acquisition_status = "done";
    item.available_pdf_path = item.pdf_path;
  } else if (
    item.source_work_pdf?.pdf_path &&
    targetExists(item.source_work_pdf.pdf_path)
  ) {
    item.pdf_status = "available_as_source_work";
    item.acquisition_status = "done_reuse_source_work_pdf";
    item.available_pdf_path = item.source_work_pdf.pdf_path;
  } else {
    item.pdf_status = "missing";
    item.acquisition_status = "todo";
    item.available_pdf_path = "";
  }
  delete item.storage_slug_base;
  delete item.source_hash;
}

const stats = {
  citation_rows: citationRows,
  unique_citing_works: items.length,
  missing_pdfs: items.filter((item) => item.pdf_status === "missing").length,
  present_pdfs: items.filter((item) => item.pdf_status === "present").length,
  reusable_source_work_pdfs: items.filter(
    (item) => item.pdf_status === "available_as_source_work"
  ).length,
  multi_work_citers: items.filter((item) => item.cites.length > 1).length,
  max_cited_source_works: Math.max(...items.map((item) => item.cites.length), 0),
};

const jsonOutput = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source: {
    cited_by: path.relative(rootDir, citedByPath),
    publications: path.relative(rootDir, publicationsPath),
    pdf_manifest: path.relative(rootDir, pdfManifestPath),
  },
  stats,
  items,
};

const highPriority = items.filter((item) => item.cites.length > 1);
const singleWork = items.filter((item) => item.cites.length === 1);
const missingItems = items.filter((item) => item.pdf_status === "missing");
const markdown = [
  "# Cited-By PDF Acquisition Checklist",
  "",
  `Generated: ${jsonOutput.generated_at}`,
  "",
  "## Stats",
  "",
  `- Citation rows: ${stats.citation_rows}`,
  `- Unique citing works: ${stats.unique_citing_works}`,
  `- Missing PDFs: ${stats.missing_pdfs}`,
  `- Present PDFs: ${stats.present_pdfs}`,
  `- Reusable source-work PDFs: ${stats.reusable_source_work_pdfs}`,
  `- Citing works that cite multiple source works: ${stats.multi_work_citers}`,
  `- Maximum source works cited by one citing work: ${stats.max_cited_source_works}`,
  "",
  "## High Priority: Cites Multiple Source Works",
  "",
  ...highPriority.map(checkbox),
  "",
  "## Single-Source Citing Works",
  "",
  ...singleWork.map(checkbox),
  "",
].join("\n");

const missingMarkdown = [
  "# Missing Cited-By PDFs",
  "",
  `Generated: ${jsonOutput.generated_at}`,
  "",
  `Missing PDFs: ${missingItems.length}`,
  "",
  "Sorted by number of your works cited, then year, then title.",
  "",
  ...missingItems.map(checkbox),
  "",
].join("\n");

const missingCSV = [
  [
    "id",
    "title",
    "year",
    "source_url",
    "source_kind",
    "cited_source_work_count",
    "cited_source_works",
    "target_pdf_path",
  ].join(","),
  ...missingItems.map((item) =>
    [
      item.id,
      item.title,
      item.year || "",
      item.source_url,
      item.source_kind,
      item.cites.length,
      item.cites.map((work) => work.title).join("; "),
      item.pdf_path,
    ].map(csvCell).join(",")
  ),
  "",
].join("\n");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonOutputPath, `${JSON.stringify(jsonOutput, null, 2)}\n`);
fs.writeFileSync(mdOutputPath, markdown);
fs.writeFileSync(missingMdOutputPath, missingMarkdown);
fs.writeFileSync(missingCsvOutputPath, missingCSV);

console.log(
  JSON.stringify(
    {
      json: path.relative(rootDir, jsonOutputPath),
      markdown: path.relative(rootDir, mdOutputPath),
      missing_markdown: path.relative(rootDir, missingMdOutputPath),
      missing_csv: path.relative(rootDir, missingCsvOutputPath),
      ...stats,
    },
    null,
    2
  )
);
