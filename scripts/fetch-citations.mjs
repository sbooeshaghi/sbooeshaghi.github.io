import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationsPath = path.join(rootDir, "db", "publications.json");
const citationsPath = path.join(rootDir, "db", "citations.json");
const openAlexMailto = "sbooeshaghi@gmail.com";
const semanticScholarDelayMs = 1100;
const allowPartialFetch = process.env.CITATION_FETCH_ALLOW_PARTIAL === "1";

const publications = JSON.parse(fs.readFileSync(publicationsPath, "utf8"));
const existingCitationData = fs.existsSync(citationsPath)
  ? JSON.parse(fs.readFileSync(citationsPath, "utf8"))
  : { works: {} };
let fetchFailureCount = 0;

function citationRowCount(data) {
  return Object.values(data.works || {}).reduce(
    (sum, work) => sum + (work.citationCount || 0),
    0
  );
}

function recordFetchFailure(error) {
  fetchFailureCount += 1;
  console.warn(error.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeDOI(value) {
  if (!value) return "";

  return String(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim()
    .toLowerCase();
}

function doiURL(value) {
  const doi = normalizeDOI(value);
  return doi ? `https://doi.org/${doi}` : "";
}

function abstractFromInvertedIndex(index) {
  if (!index) return "";

  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      words[position] = word;
    }
  }

  return words.filter(Boolean).join(" ");
}

function cleanText(value) {
  return String(value || "")
    .replace(/&lt;[^&]+?&gt;/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJSON(url, label) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": `sbooeshaghi.github.io citation fetcher; mailto:${openAlexMailto}`,
    },
  });

  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}`);
  }

  return response.json();
}

async function fetchOpenAlexWork(doi) {
  const doiLink = doiURL(doi);
  if (!doiLink) return null;

  try {
    return await fetchJSON(
      `https://api.openalex.org/works/${doiLink}?mailto=${encodeURIComponent(
        openAlexMailto
      )}`,
      `OpenAlex work ${doi}`
    );
  } catch (error) {
    recordFetchFailure(error);
    return null;
  }
}

function openAlexWorkShortId(openAlexId) {
  return String(openAlexId).split("/").pop();
}

async function fetchOpenAlexCitations(openAlexWork) {
  if (!openAlexWork?.id) return [];

  const citedWorkId = openAlexWorkShortId(openAlexWork.id);
  const citations = [];
  let cursor = "*";

  while (cursor) {
    const params = new URLSearchParams({
      filter: `referenced_works:${citedWorkId}`,
      per_page: "200",
      cursor,
      mailto: openAlexMailto,
      select: [
        "id",
        "doi",
        "title",
        "display_name",
        "publication_year",
        "publication_date",
        "type",
        "cited_by_count",
        "primary_location",
        "abstract_inverted_index",
        "referenced_works",
      ].join(","),
    });
    const payload = await fetchJSON(
      `https://api.openalex.org/works?${params.toString()}`,
      `OpenAlex citations ${citedWorkId}`
    );

    citations.push(...payload.results);
    cursor = payload.meta?.next_cursor || "";
  }

  return citations;
}

async function fetchSemanticScholarCitations(doi) {
  const normalizedDOI = normalizeDOI(doi);
  if (!normalizedDOI) return [];

  const citations = [];
  let offset = 0;
  let next = 0;

  do {
    const params = new URLSearchParams({
      fields: [
        "contexts",
        "intents",
        "isInfluential",
        "citingPaper.title",
        "citingPaper.year",
        "citingPaper.externalIds",
        "citingPaper.url",
        "citingPaper.abstract",
      ].join(","),
      limit: "100",
      offset: String(offset),
    });
    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(
      normalizedDOI
    )}/citations?${params.toString()}`;

    try {
      const payload = await fetchJSON(url, `Semantic Scholar citations ${doi}`);
      citations.push(...(payload.data || []));
      next = payload.next;
      offset = next;
    } catch (error) {
      recordFetchFailure(error);
      return citations;
    }

    if (next) {
      await sleep(semanticScholarDelayMs);
    }
  } while (next);

  return citations;
}

function citationKeyFromParts({ doi, openAlexId, semanticScholarId, title, year }) {
  if (doi) return `doi:${normalizeDOI(doi)}`;
  if (openAlexId) return `openalex:${openAlexId}`;
  if (semanticScholarId) return `s2:${semanticScholarId}`;

  return `title:${slugify(`${title || "untitled"}-${year || "unknown"}`)}`;
}

function citationURL(citation) {
  if (citation.doi) return doiURL(citation.doi);
  if (citation.url) return citation.url;
  if (citation.openAlexId) return citation.openAlexId;
  if (citation.semanticScholarUrl) return citation.semanticScholarUrl;
  return "";
}

function mergeCitation(map, citation) {
  const key = citationKeyFromParts(citation);
  const existing = map.get(key);

  if (!existing) {
    map.set(key, {
      title: citation.title,
      year: citation.year || null,
      doi: citation.doi || "",
      url: citationURL(citation),
      openAlexId: citation.openAlexId || "",
      semanticScholarId: citation.semanticScholarId || "",
      semanticScholarUrl: citation.semanticScholarUrl || "",
      sources: [...new Set(citation.sources || [])],
      citedWorkDois: [...new Set(citation.citedWorkDois || [])],
      citationContextTerms: citation.citationContextTerms || [],
      semanticScholarIntents: citation.semanticScholarIntents || [],
      hasSemanticScholarContext: Boolean(citation.hasSemanticScholarContext),
    });
    return;
  }

  existing.title ||= citation.title;
  existing.year ||= citation.year || null;
  existing.doi ||= citation.doi || "";
  existing.url ||= citationURL(citation);
  existing.openAlexId ||= citation.openAlexId || "";
  existing.semanticScholarId ||= citation.semanticScholarId || "";
  existing.semanticScholarUrl ||= citation.semanticScholarUrl || "";
  existing.sources = [...new Set([...existing.sources, ...(citation.sources || [])])];
  existing.citedWorkDois = [
    ...new Set([...existing.citedWorkDois, ...(citation.citedWorkDois || [])]),
  ];
  existing.citationContextTerms = [
    ...new Set([
      ...existing.citationContextTerms,
      ...(citation.citationContextTerms || []),
    ]),
  ].slice(0, 8);
  existing.semanticScholarIntents = [
    ...new Set([
      ...existing.semanticScholarIntents,
      ...(citation.semanticScholarIntents || []),
    ]),
  ];
  existing.hasSemanticScholarContext =
    existing.hasSemanticScholarContext || Boolean(citation.hasSemanticScholarContext);
}

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "among",
  "because",
  "before",
  "being",
  "between",
  "could",
  "first",
  "former",
  "found",
  "from",
  "have",
  "human",
  "into",
  "latter",
  "more",
  "other",
  "paper",
  "papers",
  "present",
  "research",
  "science",
  "scientific",
  "should",
  "study",
  "their",
  "there",
  "these",
  "those",
  "through",
  "using",
  "where",
  "which",
  "while",
  "with",
  "work",
  "works",
]);

function contextTerms(contexts) {
  const counts = new Map();
  const joined = contexts.join(" ");
  const terms = joined
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^a-z0-9 -]+/g, " ")
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ""))
    .filter((term) => term.length > 4 && !stopWords.has(term));

  for (const term of terms) {
    counts.set(term, (counts.get(term) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([term]) => term);
}

function summaryForCitation(citation) {
  if (citation.citationContextTerms.length) {
    return `Semantic Scholar provides citation context; prominent terms include ${citation.citationContextTerms.join(
      ", "
    )}.`;
  }

  if (citation.semanticScholarIntents.length) {
    return `Semantic Scholar labels the citation intent as ${citation.semanticScholarIntents.join(
      ", "
    )}.`;
  }

  const sources = citation.sources.join(" and ");
  const verb = citation.sources.length === 1 ? "confirms" : "confirm";
  return `${sources} ${verb} this work cites the linked work; no citation context was available from the public APIs.`;
}

function fromOpenAlexCitation(work, citedWorkDoi) {
  const location = work.primary_location || {};
  const doi = normalizeDOI(work.doi);
  const url = doiURL(doi) || location.landing_page_url || work.id;

  return {
    title: cleanText(work.display_name || work.title),
    year: work.publication_year,
    doi,
    url,
    openAlexId: work.id,
    sources: ["OpenAlex"],
    citedWorkDois: [normalizeDOI(citedWorkDoi)],
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
  };
}

function fromSemanticScholarCitation(citation, citedWorkDoi) {
  const paper = citation.citingPaper || {};
  const doi = normalizeDOI(paper.externalIds?.DOI);
  const terms = contextTerms(citation.contexts || []);

  return {
    title: cleanText(paper.title),
    year: paper.year,
    doi,
    url: doiURL(doi) || paper.url,
    semanticScholarId: paper.paperId,
    semanticScholarUrl: paper.url,
    sources: ["Semantic Scholar"],
    citedWorkDois: [normalizeDOI(citedWorkDoi)],
    citationContextTerms: terms,
    semanticScholarIntents: citation.intents || [],
    hasSemanticScholarContext: Boolean((citation.contexts || []).length),
    abstract: paper.abstract || "",
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  sources: [
    {
      name: "OpenAlex",
      note: "Citing works are retrieved with the referenced_works filter for the linked DOI's OpenAlex work ID.",
    },
    {
      name: "Semantic Scholar",
      note: "Citing works and citation context terms are retrieved from the Graph API citations endpoint when available.",
    },
  ],
  works: {},
};

for (const [index, publication] of publications.entries()) {
  const slug = slugify(publication.title);
  const citationMap = new Map();
  const linkedDois = publication.links.map((link) => normalizeDOI(link.doi));

  console.log(`[${index + 1}/${publications.length}] ${publication.title}`);

  for (const link of publication.links) {
    const citedDoi = normalizeDOI(link.doi);
    const openAlexWork = await fetchOpenAlexWork(citedDoi);

    if (openAlexWork) {
      const openAlexCitations = await fetchOpenAlexCitations(openAlexWork);
      for (const citingWork of openAlexCitations) {
        mergeCitation(citationMap, fromOpenAlexCitation(citingWork, citedDoi));
      }
    }

    const semanticScholarCitations = await fetchSemanticScholarCitations(citedDoi);
    for (const citingWork of semanticScholarCitations) {
      mergeCitation(citationMap, fromSemanticScholarCitation(citingWork, citedDoi));
    }

    await sleep(semanticScholarDelayMs);
  }

  const citations = [...citationMap.values()]
    .map((citation) => ({
      title: citation.title,
      year: citation.year,
      doi: citation.doi,
      url: citation.url,
      sources: citation.sources,
      citedWorkDois: citation.citedWorkDois,
      semanticScholarId: citation.semanticScholarId,
      openAlexId: citation.openAlexId,
      citationContextTerms: citation.citationContextTerms,
      semanticScholarIntents: citation.semanticScholarIntents,
      hasSemanticScholarContext: citation.hasSemanticScholarContext,
      summary: summaryForCitation(citation),
    }))
    .filter((citation) => citation.title)
    .filter((citation) => {
      const citingDoi = normalizeDOI(citation.doi);
      return !citingDoi || !linkedDois.includes(citingDoi);
    })
    .sort((a, b) => {
      const yearDiff = (b.year || 0) - (a.year || 0);
      return yearDiff || a.title.localeCompare(b.title);
    });

  output.works[slug] = {
    title: publication.title,
    linkedDois,
    citationCount: citations.length,
    citations,
  };

  console.log(`  ${citations.length} citing works`);
}

const existingRowCount = citationRowCount(existingCitationData);
const newRowCount = citationRowCount(output);

if (fetchFailureCount && newRowCount < existingRowCount && !allowPartialFetch) {
  throw new Error(
    [
      `Refusing to overwrite ${citationsPath} after ${fetchFailureCount} fetch failure(s).`,
      `Existing citation rows: ${existingRowCount}; new citation rows: ${newRowCount}.`,
      "Set CITATION_FETCH_ALLOW_PARTIAL=1 to write this partial result intentionally.",
    ].join("\n")
  );
}

fs.writeFileSync(citationsPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${citationsPath}`);
