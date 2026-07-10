#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDoi,
  recipeHash,
  taskHash,
  titlesPlausiblyMatch,
} from "../tools/sciindex/bundles/scientific-literature/tasks/paper/lib/common.mjs";
import { sourceWorkCatalogByDoi } from "./lib/source-work-catalog.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg.startsWith("--accepted=")) args.accepted = arg.slice("--accepted=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(rootDir, args.out || "db/resource-index.json");

function readJSON(relativePath, fallback) {
  const filePath = path.join(rootDir, relativePath);
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, "utf8"))
    : fallback;
}

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function sha256File(relativePath) {
  const filePath = path.join(rootDir, relativePath || "");
  return relativePath && fs.existsSync(filePath)
    ? crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
    : "";
}

function existingPath(relativePath) {
  return relativePath && fs.existsSync(path.join(rootDir, relativePath))
    ? relativePath
    : "";
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

function compactSlug(value, maxLength = 110) {
  const slug = slugify(value) || "untitled";
  if (slug.length <= maxLength) return slug;
  const hash = sha1(slug).slice(0, 10);
  return `${slug.slice(0, maxLength - hash.length - 1).replace(/-+$/g, "")}-${hash}`;
}

function cleanTitle(value) {
  return String(value || "").replace(/^\s*\[(?:HTML|PDF|BOOK|CITATION)\]\s*/i, "").trim();
}

function titleKey(value) {
  return slugify(cleanTitle(value));
}

function yearFrom(value) {
  const match = String(value || "").match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function normalizeURL(value) {
  return String(value || "").trim().replace(/\/+$/g, "").toLowerCase();
}

function versionURL(version) {
  const value = version.url || version.doi || "";
  const doi = normalizeDoi(value);
  if (/^https?:\/\//i.test(value)) return value;
  return doi ? `https://doi.org/${doi}` : "";
}

function publicationVersions(publication) {
  const versions = publication.versions?.length ? publication.versions : publication.links || [];
  return versions.map((version) => ({
    ...version,
    title: version.title || publication.title,
    url: version.url || version.doi || "",
  }));
}

function normalizeOrcid(value) {
  const match = String(value || "").match(/(\d{4}-\d{4}-\d{4}-[\dX]{4})/i);
  return match ? match[1].toUpperCase() : "";
}

function personId(author) {
  const orcid = normalizeOrcid(author?.orcid);
  return orcid
    ? `person:orcid:${orcid}`
    : `person:local:${slugify(author?.name) || "unknown"}`;
}

function compactAuthors(authors) {
  const seen = new Set();
  return (authors || []).filter((author) => {
    const key = `${author?.name || ""}\u0000${author?.orcid || ""}`;
    if (!author?.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const publications = readJSON("db/publications.json", []);
const citedBy = readJSON("db/cited-by.json", { works: {} });
const publicationAuthors = readJSON("db/publication-authors.json", { works: {} });
const pdfManifest = readJSON("db/pdf-manifest.local.json", { source_work_versions: [] });
const citedChecklist = readJSON("local/citation-context/cited-by-pdf-checklist.local.json", { items: [] });
const acceptedPath = path.resolve(
  rootDir,
  args.accepted || "local/sciindex/paper/accepted.json"
);
const accepted = fs.existsSync(acceptedPath)
  ? JSON.parse(fs.readFileSync(acceptedPath, "utf8"))
  : null;

if (accepted) {
  if (
    accepted.schema_version !== "sciindex-accepted-v0" ||
    accepted.recipe_sha256 !== recipeHash() ||
    accepted.task_sha256 !== taskHash()
  ) {
    throw new Error("Accepted paper artifact is stale for the current bundle");
  }
}

const objects = new Map();
const connections = new Map();
const sources = new Map();
const addObject = (value) => objects.set(value.id, value);
const addConnection = (value) => connections.set(value.id, value);
const addSource = (value) => sources.set(value.id, value);

const authorVersions = new Map();
for (const [workSlug, work] of Object.entries(publicationAuthors.works || {})) {
  const byDoi = new Map();
  const byDateVenue = new Map();
  for (const version of work.versions || []) {
    const doi = normalizeDoi(version.doi);
    if (doi) byDoi.set(doi, version.authors || []);
    byDateVenue.set(
      `${version.date || ""}\u0000${slugify(version.name || "")}`,
      version.authors || []
    );
  }
  authorVersions.set(workSlug, { byDoi, byDateVenue, fallback: work.versions?.[0]?.authors || [] });
}

function authorsFor(workSlug, version) {
  const index = authorVersions.get(workSlug);
  if (!index) return [];
  const doi = normalizeDoi(version.doi || version.url);
  return compactAuthors(
    index.byDoi.get(doi) ||
      index.byDateVenue.get(`${version.date || ""}\u0000${slugify(version.name || "")}`) ||
      index.fallback
  );
}

const manifestByVersion = new Map(
  (pdfManifest.source_work_versions || []).map((item) => [item.version_id, item])
);
const manifestByWorkDoi = new Map();
const manifestByWorkDateVenue = new Map();
for (const item of pdfManifest.source_work_versions || []) {
  const doi = normalizeDoi(item.version_url);
  if (doi) {
    const key = `${item.work_slug}\u0000${doi}`;
    manifestByWorkDoi.set(key, [...(manifestByWorkDoi.get(key) || []), item]);
  }
  manifestByWorkDateVenue.set(
    `${item.work_slug}\u0000${item.date || ""}\u0000${slugify(item.source || "")}`,
    item
  );
}

const acceptedById = new Map((accepted?.papers || []).map((paper) => [paper.id, paper]));
const acceptedByVersion = new Map(
  (accepted?.papers || [])
    .filter((paper) => paper.input.version_id)
    .map((paper) => [paper.input.version_id, paper])
);
const acceptedByDoi = new Map();
const acceptedByTitleYear = new Map();
function appendToIndex(index, key, value) {
  index.set(key, [...(index.get(key) || []), value]);
}

for (const paper of accepted?.papers || []) {
  const doi = normalizeDoi(paper.input.doi || paper.paper.doi);
  if (doi) appendToIndex(acceptedByDoi, doi, paper);
  appendToIndex(
    acceptedByTitleYear,
    `${titleKey(paper.input.title || paper.paper.title)}\u0000${paper.input.year || paper.paper.year || ""}`,
    paper
  );
}

function onlyCandidate(index, key) {
  const candidates = index.get(key) || [];
  return candidates.length === 1 ? candidates[0] : null;
}

function addPerson(author) {
  const id = personId(author);
  if (objects.has(id)) return id;
  const name = String(author.name || "").trim();
  const orcid = normalizeOrcid(author.orcid);
  addObject({
    id,
    kind: "person",
    label: name,
    description: name,
    properties: {
      identifiers: [
        orcid ? { namespace: "orcid", value: `https://orcid.org/${orcid}` } : null,
        { namespace: "local", value: id },
      ].filter(Boolean),
      aliases: [name],
    },
  });
  return id;
}

function addDocument({ id, publicationId, kind, pdfPath, pdfSha256, textPath, textSha256, pageCount }) {
  pdfPath = existingPath(pdfPath);
  textPath = existingPath(textPath);
  if (!pdfPath && !textPath) return null;
  const documentId = `document:${id}`;
  const finalPdfHash = pdfSha256 || sha256File(pdfPath);
  const finalTextHash = textSha256 || sha256File(textPath);
  addObject({
    id: documentId,
    kind: "source_document",
    label: path.basename(pdfPath || textPath),
    description: textPath || pdfPath,
    properties: {
      version_id: publicationId,
      document_kind: kind,
      pdf_path: pdfPath || "",
      text_path: textPath || "",
      page_count: pageCount || null,
      pdf_sha256: finalPdfHash,
      text_sha256: finalTextHash,
      local_only: true,
      identifiers: [{ namespace: "local", value: documentId }],
    },
  });
  addConnection({
    id: `connection:${documentId}--${publicationId}`,
    source: documentId,
    target: publicationId,
    statement: "This source document provides local provenance for the publication.",
    evidence: [],
    properties: {},
  });
  if (pdfPath) {
    addSource({
      id: `source:pdf:${documentId}`,
      kind: "local_pdf",
      label: path.basename(pdfPath),
      locator: pdfPath,
      properties: { document_id: documentId, sha256: finalPdfHash, local_only: true },
    });
  }
  if (textPath) {
    addSource({
      id: `source:text:${documentId}`,
      kind: "local_text",
      label: path.basename(textPath),
      locator: textPath,
      properties: { document_id: documentId, sha256: finalTextHash, local_only: true },
    });
  }
  return documentId;
}

function groundedEvidence(items, documentId) {
  if (!documentId || !sources.has(`source:text:${documentId}`)) return [];
  return (items || [])
    .filter((item) => String(item?.span || "").trim())
    .map((item) => ({
      source: `source:text:${documentId}`,
      span: item.span,
      page: Number.isInteger(item.page) ? item.page : null,
      properties: { document_id: documentId },
    }));
}

function addSummaryClaim(publicationId, statement, evidence, provenance) {
  if (!statement || !evidence.length) return;
  const claimId = `claim:${publicationId}--summary`;
  addObject({
    id: claimId,
    kind: "claim",
    label: statement.slice(0, 120),
    description: statement,
    properties: {
      source_publication_id: publicationId,
      evidence,
      provenance,
      identifiers: [{ namespace: "local", value: claimId }],
    },
  });
  addConnection({
    id: `connection:${publicationId}--${claimId}`,
    source: publicationId,
    target: claimId,
    statement: "This publication contains this grounded claim.",
    evidence,
    properties: { provenance },
  });
}

const ownedVersionsByDoi = new Map();
const ownedVersionsByTitle = new Map();
const ownedWorkBySlug = new Map();
const ownedPublicationByVersionId = new Map();

for (const publication of publications) {
  const workSlug = slugify(publication.title);
  const workId = `work:${workSlug}`;
  const versionIds = [];

  for (const version of publicationVersions(publication)) {
    const doi = normalizeDoi(version.doi || version.url);
    const exactManifest = manifestByWorkDateVenue.get(
      `${workSlug}\u0000${version.date || ""}\u0000${slugify(version.name || "")}`
    );
    const doiManifests = manifestByWorkDoi.get(`${workSlug}\u0000${doi}`) || [];
    const manifest = exactManifest || (doiManifests.length === 1 ? doiManifests[0] : null);
    const rawVersionId =
      manifest?.version_id ||
      `${workSlug}--${slugify([version.date, version.name].filter(Boolean).join(" "))}`;
    const publicationId = `version:${rawVersionId}`;
    const acceptedPaper = acceptedByVersion.get(rawVersionId);
    const source = acceptedPaper?.source || {};
    const documentId = addDocument({
      id: rawVersionId,
      publicationId,
      kind: "source_work",
      pdfPath: source.pdf_path || manifest?.pdf?.path || "",
      pdfSha256: source.pdf_sha256 || manifest?.pdf?.sha256 || "",
      textPath: source.text_path || manifest?.text?.path || "",
      textSha256: source.text_sha256 || "",
      pageCount: manifest?.pdf?.pages || manifest?.text?.pages || null,
    });
    const summary =
      acceptedPaper?.paper?.statement || version.summary || "";
    const summaryItems = acceptedPaper?.paper?.evidence || [];
    const evidence = groundedEvidence(summaryItems, documentId);
    const authors = authorsFor(workSlug, version);
    addObject({
      id: publicationId,
      kind: "publication",
      label: version.title || publication.title,
      description: summary,
      properties: {
        work_id: workId,
        year: yearFrom(version.date),
        date: version.date || "",
        venue: version.name || "",
        doi,
        url: versionURL(version),
        aliases: [doi, versionURL(version)].filter(Boolean),
        authors,
        document_id: documentId,
        identifiers: [
          doi ? { namespace: "doi", value: doi } : null,
          versionURL(version) ? { namespace: "url", value: versionURL(version) } : null,
          { namespace: "local", value: publicationId },
        ].filter(Boolean),
      },
    });
    addConnection({
      id: `connection:${publicationId}--${workId}`,
      source: publicationId,
      target: workId,
      statement: `${version.date || "This publication"} is a version of ${publication.title}.`,
      evidence: [],
      properties: {},
    });
    addSummaryClaim(publicationId, summary, evidence, {
      task: "paper",
    });
    authors.forEach((author, index) => {
      const target = addPerson(author);
      addConnection({
        id: `connection:${publicationId}--${target}--author-${index + 1}`,
        source: publicationId,
        target,
        statement: `${author.name} is an author of ${version.title || publication.title}.`,
        evidence: [],
        properties: { author_position: index + 1 },
      });
    });
    versionIds.push(publicationId);
    ownedPublicationByVersionId.set(rawVersionId, {
      workId,
      publicationId,
      documentId,
      acceptedPaper,
    });
    if (doi) {
      ownedVersionsByDoi.set(doi, [...(ownedVersionsByDoi.get(doi) || []), publicationId]);
    }
  }

  addObject({
    id: workId,
    kind: "work",
    label: publication.title,
    description: publication.summary || "",
    properties: {
      collection: "my_work",
      slug: workSlug,
      aliases: [workSlug],
      version_ids: versionIds,
      identifiers: [{ namespace: "local", value: workId }],
    },
  });
  ownedWorkBySlug.set(workSlug, workId);
  ownedVersionsByTitle.set(titleKey(publication.title), versionIds);
}

for (const paper of accepted?.papers || []) {
  if (paper.input.version_id && !ownedPublicationByVersionId.has(paper.input.version_id)) {
    throw new Error(`Accepted paper does not map to a publication version: ${paper.id}`);
  }
}

const checklistByUrl = new Map();
const checklistByTitleYear = new Map();
for (const item of citedChecklist.items || []) {
  checklistByUrl.set(normalizeURL(item.source_url), item);
  const doi = normalizeDoi(item.source_url);
  if (doi) checklistByUrl.set(`doi:${doi}`, item);
  checklistByTitleYear.set(`${titleKey(item.title)}\u0000${item.year || ""}`, item);
}

function checklistFor(row) {
  const doi = normalizeDoi(row.link);
  return (
    checklistByUrl.get(normalizeURL(row.link)) ||
    (doi ? checklistByUrl.get(`doi:${doi}`) : null) ||
    checklistByTitleYear.get(`${titleKey(row.title)}\u0000${row.year || ""}`) ||
    null
  );
}

function acceptedFor(row, checklist) {
  const doi = normalizeDoi(row.link);
  const candidate =
    (checklist ? acceptedById.get(checklist.id) : null) ||
    (doi ? onlyCandidate(acceptedByDoi, doi) : null) ||
    onlyCandidate(acceptedByTitleYear, `${titleKey(row.title)}\u0000${row.year || ""}`) ||
    null;
  return candidate?.input?.version_id ? null : candidate;
}

function latestVersion(ids) {
  return [...ids].sort((a, b) => {
    const left = objects.get(a)?.properties?.date || "";
    const right = objects.get(b)?.properties?.date || "";
    return right.localeCompare(left);
  })[0];
}

const citingByKey = new Map();
const citingByAcceptedId = new Map();

function ensureCiting(row) {
  const checklist = checklistFor(row);
  const acceptedPaper = acceptedFor(row, checklist);
  const doi = normalizeDoi(row.link || acceptedPaper?.input?.doi);
  const ownedIds = doi
    ? ownedVersionsByDoi.get(doi)
    : ownedVersionsByTitle.get(titleKey(row.title));
  if (ownedIds?.length) {
    const publicationId = latestVersion(ownedIds);
    const result = {
      workId: objects.get(publicationId).properties.work_id,
      publicationId,
      documentId: objects.get(publicationId).properties.document_id,
      acceptedPaper,
    };
    if (acceptedPaper) citingByAcceptedId.set(acceptedPaper.id, result);
    return result;
  }

  const key = doi
    ? `doi:${doi}`
    : `title:${titleKey(row.title)}:${row.year || ""}`;
  if (citingByKey.has(key)) return citingByKey.get(key);

  const slug = compactSlug(
    checklist?.id?.replace(/^cited-by--/, "") ||
      (doi ? `doi ${doi}` : `${row.year || "n-d"} ${cleanTitle(row.title)}`)
  );
  const workId = `work:citing:${slug}`;
  const publicationId = `version:citing:${slug}`;
  const source = acceptedPaper?.source || {};
  const pdfPath =
    source.pdf_path ||
    checklist?.available_pdf_path ||
    (checklist?.pdf_status === "present" ? checklist.pdf_path : "") ||
    "";
  const textPath = source.text_path || checklist?.text_path || "";
  const documentId = addDocument({
    id: checklist?.id || `citing-${slug}`,
    publicationId,
    kind: "citing_work",
    pdfPath,
    pdfSha256: source.pdf_sha256 || "",
    textPath,
    textSha256: source.text_sha256 || "",
    pageCount: null,
  });
  const summary = acceptedPaper?.paper?.statement || row.summary || "";
  const evidence = groundedEvidence(acceptedPaper?.paper?.evidence || [], documentId);
  addObject({
    id: workId,
    kind: "work",
    label: cleanTitle(row.title),
    description: summary,
    properties: {
      collection: "citing_work",
      slug,
      aliases: [slug],
      version_ids: [publicationId],
      identifiers: [{ namespace: "local", value: workId }],
    },
  });
  addObject({
    id: publicationId,
    kind: "publication",
    label: cleanTitle(row.title),
    description: summary,
    properties: {
      work_id: workId,
      year: Number.isInteger(row.year) ? row.year : yearFrom(row.year),
      date: row.year ? String(row.year) : "",
      venue: "",
      doi,
      url: row.link || acceptedPaper?.input?.source_url || "",
      aliases: [doi, row.link].filter(Boolean),
      authors: [],
      document_id: documentId,
      identifiers: [
        doi ? { namespace: "doi", value: doi } : null,
        row.link ? { namespace: "url", value: row.link } : null,
        { namespace: "local", value: publicationId },
      ].filter(Boolean),
    },
  });
  addConnection({
    id: `connection:${publicationId}--${workId}`,
    source: publicationId,
    target: workId,
    statement: "This publication is the indexed version of the citing work.",
    evidence: [],
    properties: {},
  });
  addSummaryClaim(publicationId, summary, evidence, { task: acceptedPaper ? "paper" : "" });

  const result = { workId, publicationId, documentId, acceptedPaper };
  citingByKey.set(key, result);
  if (acceptedPaper) citingByAcceptedId.set(acceptedPaper.id, result);
  return result;
}

for (const [targetSlug, work] of Object.entries(citedBy.works || {})) {
  const targetWorkId = ownedWorkBySlug.get(targetSlug);
  if (!targetWorkId) continue;
  for (const row of work.cited_by || []) {
    const citing = ensureCiting(row);
    const id = `connection:citation:${compactSlug(`${citing.publicationId} ${targetWorkId}`, 180)}`;
    addConnection({
      id,
      source: citing.publicationId,
      target: targetWorkId,
      statement: `${objects.get(citing.workId).label} cites ${objects.get(targetWorkId).label}.`,
      evidence: [],
      properties: { source_work_id: citing.workId },
    });
  }
}

const sourceCatalog = sourceWorkCatalogByDoi();
for (const paper of accepted?.papers || []) {
  const citing = paper.input.version_id
    ? ownedPublicationByVersionId.get(paper.input.version_id)
    : citingByAcceptedId.get(paper.id);
  if (!citing) continue;

  for (const [index, reference] of (paper.references || []).entries()) {
    if (reference.status !== "used" || !reference.statement) continue;
    const doi = normalizeDoi(reference.doi);
    const target = sourceCatalog.get(doi);
    const titleMatches =
      !String(reference.title || "").trim() ||
      target?.titles?.some((title) => titlesPlausiblyMatch(reference.title, title));
    if (!target || !titleMatches) continue;
    const targetWorkId = ownedWorkBySlug.get(target.work_slug);
    if (!targetWorkId) continue;
    addConnection({
      id: `connection:citation:${compactSlug(`${citing.publicationId} ${targetWorkId}`, 180)}`,
      source: citing.publicationId,
      target: targetWorkId,
      statement: `${objects.get(citing.workId).label} cites ${objects.get(targetWorkId).label}.`,
      evidence: [],
      properties: { source_work_id: citing.workId },
    });
    const candidateVersions = ownedVersionsByDoi.get(doi) || [];
    const targetId = candidateVersions.length === 1 ? candidateVersions[0] : targetWorkId;
    const evidence = groundedEvidence(reference.evidence, citing.documentId);
    if (!evidence.length) continue;
    const claimId = `claim:citation:${compactSlug(
      `${citing.publicationId} ${targetId} ${reference.ref || index}`,
      180
    )}`;
    addObject({
      id: claimId,
      kind: "claim",
      label: reference.statement.slice(0, 120),
      description: reference.statement,
      properties: {
        source_work_id: citing.workId,
        source_publication_id: citing.publicationId,
        target_work_id: targetWorkId,
        target_publication_id: targetId === targetWorkId ? "" : targetId,
        cited_as: reference.ref,
        cited_doi: doi,
        evidence,
        provenance: { task: "paper", output_sha256: paper.provenance.output_sha256 },
        identifiers: [{ namespace: "local", value: claimId }],
      },
    });
    addConnection({
      id: `connection:${citing.publicationId}--${claimId}`,
      source: citing.publicationId,
      target: claimId,
      statement: "This publication contains this citation-context claim.",
      evidence,
      properties: { source_work_id: citing.workId },
    });
    addConnection({
      id: `connection:${claimId}--${targetId}`,
      source: claimId,
      target: targetId,
      statement: reference.statement,
      evidence,
      properties: {
        source_work_id: citing.workId,
        source_publication_id: citing.publicationId,
        target_work_id: targetWorkId,
      },
    });
  }
}

const resourceIndex = {
  schema_version: "resource-index-v0",
  recipe: {
    id: "scientific-literature",
    version: 1,
    sha256: recipeHash(),
  },
  objects: [...objects.values()].sort((a, b) => a.id.localeCompare(b.id)),
  connections: [...connections.values()].sort((a, b) => a.id.localeCompare(b.id)),
  sources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
};

writeJSON(outputPath, resourceIndex);
console.log(
  `Wrote ${path.relative(rootDir, outputPath)} with ${resourceIndex.objects.length} objects, ${resourceIndex.connections.length} connections, and ${resourceIndex.sources.length} sources.`
);
