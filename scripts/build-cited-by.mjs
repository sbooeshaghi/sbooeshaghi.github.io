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

const publications = JSON.parse(fs.readFileSync(publicationsPath, "utf8"));
const citationData = fs.existsSync(citationsPath)
  ? JSON.parse(fs.readFileSync(citationsPath, "utf8"))
  : { works: {} };
const googleScholarCitationData = fs.existsSync(googleScholarCitationsPath)
  ? JSON.parse(fs.readFileSync(googleScholarCitationsPath, "utf8"))
  : { works: {} };

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCitationTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCitationDOI(value) {
  return String(value || "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim()
    .toLowerCase();
}

function citationKey(citation) {
  const doi = normalizeCitationDOI(citation.doi);

  if (doi) {
    return `doi:${doi}`;
  }

  return citationTitleKey(citation);
}

function citationTitleKey(citation) {
  const title = normalizeCitationTitle(citation.title).replace(/\s+/g, "");

  return `title:${title}:${citation.year || ""}`;
}

function citationLink(citation) {
  return citation.link || citation.url || "";
}

function usefulSummary(citation) {
  const summary = citation.summary || "";

  if (/confirms? this work cites the linked work/i.test(summary)) {
    return "";
  }

  return summary;
}

function googleScholarCitations(slug) {
  const entry = googleScholarCitationData.works?.[slug] || {};
  const citations = Array.isArray(entry)
    ? entry
    : entry.cited_by || entry.citations || [];

  return citations.map((citation) => ({
    title: citation.title,
    year: citation.year || null,
    doi: citation.doi || "",
    link: citationLink(citation),
    summary: citation.summary || "",
  }));
}

function mergeCitations(slug) {
  const citations = new Map();
  const titleKeys = new Map();
  const apiCitations = citationData.works?.[slug]?.citations || [];

  for (const citation of apiCitations) {
    const key = citationKey(citation);
    const row = {
      title: citation.title,
      link: citationLink(citation),
      year: citation.year || null,
      summary: usefulSummary(citation),
      doi: citation.doi || "",
    };

    citations.set(key, row);
    titleKeys.set(citationTitleKey(row), key);
  }

  for (const citation of googleScholarCitations(slug)) {
    const key = citations.has(citationKey(citation))
      ? citationKey(citation)
      : titleKeys.get(citationTitleKey(citation)) || citationKey(citation);
    const existing = citations.get(key);

    if (!existing) {
      citations.set(key, citation);
      titleKeys.set(citationTitleKey(citation), key);
      continue;
    }

    existing.link ||= citation.link;
    existing.year ||= citation.year || null;
    existing.summary ||= citation.summary || "";
  }

  return [...citations.values()]
    .filter((citation) => citation.title)
    .sort((a, b) => {
      const yearDiff = (b.year || 0) - (a.year || 0);
      return yearDiff || String(a.title).localeCompare(String(b.title));
    })
    .map((citation) => ({
      title: citation.title,
      link: citation.link || "",
      year: citation.year || null,
      summary: citation.summary || "",
    }));
}

const output = {
  generatedAt: new Date().toISOString(),
  note: "Minimal citation table data generated from db/citations.json and db/google-scholar-citations.json. Each cited_by row intentionally contains only the fields needed to render and later annotate the Works pages.",
  sources: ["OpenAlex", "Semantic Scholar", "Google Scholar"],
  works: {},
};

for (const publication of publications) {
  const slug = slugify(publication.title);

  output.works[slug] = {
    title: publication.title,
    cited_by: mergeCitations(slug),
  };
}

fs.writeFileSync(citedByPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${citedByPath}`);
