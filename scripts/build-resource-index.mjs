#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDoi,
  recipeHash,
  titlesPlausiblyMatch,
} from "../tools/sciindex/bundles/scientific-literature/lib/common.mjs";
import { taskHash as claimsTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/claims/lib/common.mjs";
import { taskHash as resultsTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/results/lib/common.mjs";
import { taskHash as summaryTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/summary/lib/common.mjs";
import { taskHash as referencesTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/references/lib/common.mjs";
import {
  artifactRef,
  mergeProvenanceProperties,
  provenanceRefs,
  withProvenance,
} from "../tools/sciindex/provenance.mjs";
import { acceptedArtifactId } from "./lib/accepted-artifact.mjs";
import { sourceWorkCatalogByDoi } from "./lib/source-work-catalog.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg.startsWith("--claims=")) args.claims = arg.slice("--claims=".length);
    else if (arg.startsWith("--results=")) args.results = arg.slice("--results=".length);
    else if (arg.startsWith("--summaries=")) args.summaries = arg.slice("--summaries=".length);
    else if (arg.startsWith("--references=")) args.references = arg.slice("--references=".length);
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
const recipe = readJSON("tools/sciindex/bundles/scientific-literature/recipe.json", {});
const citedBy = readJSON("db/cited-by.json", { works: {} });
const publicationAuthors = readJSON("db/publication-authors.json", { works: {} });
const pdfManifest = readJSON("db/pdf-manifest.local.json", { source_work_versions: [] });
const citedChecklist = readJSON("local/citation-context/cited-by-pdf-checklist.local.json", { items: [] });
function readAccepted(value, fallback) {
  const filePath = path.resolve(rootDir, value || fallback);
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
}
const acceptedClaims = readAccepted(args.claims, "local/sciindex/claims/accepted.json");
const acceptedResults = readAccepted(args.results, "local/sciindex/results/accepted.json");
const acceptedSummaries = readAccepted(args.summaries, "local/sciindex/summary/accepted.json");
const acceptedReferences = readAccepted(args.references, "local/sciindex/references/accepted.json");

const artifacts = {
  publications: artifactRef("publication-metadata", sha256File("db/publications.json")),
  citations: artifactRef("citation-metadata", sha256File("db/cited-by.json")),
  authors: artifactRef("author-metadata", sha256File("db/publication-authors.json")),
  pdfManifest: artifactRef("pdf-manifest", sha256File("db/pdf-manifest.local.json")),
  citedChecklist: artifactRef(
    "citation-checklist",
    sha256File("local/citation-context/cited-by-pdf-checklist.local.json")
  ),
};

function taskArtifact(producer, value) {
  const expected = acceptedArtifactId(producer, value);
  if (value?.provenance?.artifact_id && value.provenance.artifact_id !== expected) {
    throw new Error(`Accepted ${producer} artifact ${value.id} has a mismatched artifact id`);
  }
  return expected;
}

function verifyAccepted(value, taskId, expectedTaskHash) {
  if (!value) return;
  if (
    value.schema_version !== "sciindex-accepted-v0" ||
    value.bundle_id !== "scientific-literature" ||
    value.task_id !== taskId ||
    value.recipe_sha256 !== recipeHash() ||
    value.task_sha256 !== expectedTaskHash
  ) {
    throw new Error(`Accepted ${taskId} artifact is stale for the current bundle`);
  }
}

verifyAccepted(acceptedClaims, "claims", claimsTaskHash());
verifyAccepted(acceptedResults, "results", resultsTaskHash());
verifyAccepted(acceptedSummaries, "summary", summaryTaskHash());
verifyAccepted(acceptedReferences, "references", referencesTaskHash());

const objects = new Map();
const connections = new Map();
const sources = new Map();
function mergeEvidence(left = [], right = []) {
  const items = new Map();
  for (const item of [...left, ...right]) items.set(JSON.stringify(item), item);
  return [...items.values()];
}

function mergeUnique(left = [], right = []) {
  const items = new Map();
  for (const item of [...left, ...right]) items.set(JSON.stringify(item), item);
  return [...items.values()];
}

function requireCompatible(existing, value, fields, recordType) {
  for (const field of fields) {
    if (existing[field] && value[field] && existing[field] !== value[field]) {
      throw new Error(`${recordType} ${value.id} has conflicting ${field}`);
    }
  }
}

function addObject(value) {
  const existing = objects.get(value.id);
  if (!existing) {
    objects.set(value.id, value);
    return;
  }
  requireCompatible(existing, value, ["kind"], "Object");
  if (existing.kind !== "person") {
    requireCompatible(existing, value, ["description"], "Object");
  }
  existing.properties = mergeProvenanceProperties(existing.properties, value.properties);
  const alternateLabels = existing.label !== value.label ? [value.label] : [];
  for (const field of ["identifiers", "aliases"]) {
    if (
      existing.properties[field] ||
      value.properties[field] ||
      (field === "aliases" && alternateLabels.length)
    ) {
      existing.properties[field] = mergeUnique(
        existing.properties[field] || [],
        [
          ...(value.properties[field] || []),
          ...(field === "aliases" ? alternateLabels : []),
        ]
      );
    }
  }
}

function addConnection(value) {
  const existing = connections.get(value.id);
  if (!existing) {
    connections.set(value.id, value);
    return;
  }
  requireCompatible(
    existing,
    value,
    ["source", "target", "statement"],
    "Connection"
  );
  existing.evidence = mergeEvidence(existing.evidence, value.evidence);
  existing.properties = mergeProvenanceProperties(existing.properties, value.properties);
}
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

function acceptedIndexes(value) {
  return {
    byId: new Map((value?.papers || []).map((paper) => [paper.id, paper])),
    byVersion: new Map(
      (value?.papers || [])
        .filter((paper) => paper.input?.version_id)
        .map((paper) => [paper.input.version_id, paper])
    ),
  };
}
const claimIndexes = acceptedIndexes(acceptedClaims);
const resultIndexes = acceptedIndexes(acceptedResults);
const summaryIndexes = acceptedIndexes(acceptedSummaries);
const referenceIndexes = acceptedIndexes(acceptedReferences);
function addPerson(author, provenance) {
  const id = personId(author);
  const name = String(author.name || "").trim();
  const orcid = normalizeOrcid(author.orcid);
  addObject({
    id,
    kind: "person",
    label: name,
    description: name,
    properties: withProvenance({
      identifiers: [
        orcid ? { namespace: "orcid", value: `https://orcid.org/${orcid}` } : null,
        { namespace: "local", value: id },
      ].filter(Boolean),
      aliases: [name],
    }, provenance),
  });
  return id;
}

function addDocument({
  id,
  publicationId,
  kind,
  pdfPath,
  pdfSha256,
  textPath,
  textSha256,
  pageCount,
  provenance,
}) {
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
    properties: withProvenance({
      version_id: publicationId,
      document_kind: kind,
      pdf_path: pdfPath || "",
      text_path: textPath || "",
      page_count: pageCount || null,
      pdf_sha256: finalPdfHash,
      text_sha256: finalTextHash,
      local_only: true,
      identifiers: [{ namespace: "local", value: documentId }],
    }, provenance),
  });
  addConnection({
    id: `connection:${documentId}--${publicationId}`,
    source: documentId,
    target: publicationId,
    statement: "This source document provides local provenance for the publication.",
    evidence: [],
    properties: withProvenance({}, provenance),
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

function appendUnique(values = [], value) {
  if (!value || values.includes(value)) return values;
  values.push(value);
  return values;
}

function addAcceptedClaims({ paper, publicationId, workId, documentId }) {
  if (!paper) return;
  const provenance = taskArtifact("claims", paper);
  for (const [index, claim] of (paper.claims || []).entries()) {
    const position = claim.position || index + 1;
    const evidence = groundedEvidence(claim.evidence, documentId);
    addObject({
      id: claim.id,
      kind: "claim",
      label: claim.statement.slice(0, 120),
      description: claim.statement,
      properties: withProvenance({
        source_work_id: workId,
        source_publication_id: publicationId,
        claim_position: position,
        evidence,
        identifiers: [{ namespace: "local", value: claim.id }],
      }, provenance),
    });
    addConnection({
      id: `connection:${publicationId}--${claim.id}`,
      source: publicationId,
      target: claim.id,
      statement: "This publication contains this grounded claim.",
      evidence,
      properties: withProvenance({ source_work_id: workId, claim_position: position }, provenance),
    });
  }
}

function requirePublicationClaim(claimId, publicationId, context) {
  const claim = objects.get(claimId);
  if (claim?.kind !== "claim") {
    throw new Error(`${context} references missing claim ${claimId}`);
  }
  if (claim.properties?.source_publication_id !== publicationId) {
    throw new Error(`${context} references claim ${claimId} from another publication`);
  }
  return claim;
}

function addAcceptedResults({ paper, publicationId, workId }) {
  if (!paper) return;
  const provenance = taskArtifact("results", paper);
  for (const [index, result] of (paper.results || []).entries()) {
    const position = result.position || index + 1;
    addObject({
      id: result.id,
      kind: "result",
      label: result.statement.slice(0, 120),
      description: result.statement,
      properties: withProvenance({
        source_work_id: workId,
        source_publication_id: publicationId,
        result_position: position,
        identifiers: [{ namespace: "local", value: result.id }],
      }, provenance),
    });
    addConnection({
      id: `connection:${publicationId}--${result.id}`,
      source: publicationId,
      target: result.id,
      statement: "This publication reports this result.",
      evidence: [],
      properties: withProvenance({ source_work_id: workId, result_position: position }, provenance),
    });
    for (const claimId of result.claims || []) {
      requirePublicationClaim(claimId, publicationId, `Result ${result.id}`);
      addConnection({
        id: `connection:${result.id}--${claimId}`,
        source: result.id,
        target: claimId,
        statement: "This claim supports this result.",
        evidence: [],
        properties: withProvenance({}, provenance),
      });
    }
  }
}

const ownedVersionsByDoi = new Map();
const ownedVersionsByTitle = new Map();
const ownedWorkBySlug = new Map();
const ownedPublicationByVersionId = new Map();

for (const publication of publications) {
  const workSlug = slugify(publication.title);
  const workId = `work:${workSlug}`;
  const versionIds = [];
  let preferredWorkSummary = publication.summary || "";
  let preferredSummaryDate = "";
  let preferredSummaryArtifact = "";

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
    const claimsPaper = claimIndexes.byVersion.get(rawVersionId);
    const resultsPaper = resultIndexes.byVersion.get(rawVersionId);
    const summaryPaper = summaryIndexes.byVersion.get(rawVersionId);
    const referencesPaper = referenceIndexes.byVersion.get(rawVersionId);
    const missingTasks = [
      ["claims", claimsPaper],
      ["results", resultsPaper],
      ["summary", summaryPaper],
      ["references", referencesPaper],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missingTasks.length) {
      throw new Error(
        `Publication version ${rawVersionId} is missing accepted ${missingTasks.join(", ")} artifacts`
      );
    }
    const claimsArtifact = claimsPaper ? taskArtifact("claims", claimsPaper) : "";
    const resultsArtifact = resultsPaper ? taskArtifact("results", resultsPaper) : "";
    const summaryArtifact = summaryPaper ? taskArtifact("summary", summaryPaper) : "";
    const referencesArtifact = referencesPaper ? taskArtifact("references", referencesPaper) : "";
    for (const [taskId, paper] of [
      ["results", resultsPaper],
      ["summary", summaryPaper],
      ["references", referencesPaper],
    ]) {
      if (paper.provenance?.source_claims_artifact !== claimsArtifact) {
        throw new Error(`${taskId} artifact for ${rawVersionId} has stale claims lineage`);
      }
    }
    const versionProvenance = provenanceRefs(
      artifacts.publications,
      manifest ? artifacts.pdfManifest : "",
      claimsArtifact,
      resultsArtifact,
      summaryArtifact,
      referencesArtifact
    );
    const source = claimsPaper?.source || {};
    const documentId = addDocument({
      id: rawVersionId,
      publicationId,
      kind: "source_work",
      pdfPath: source.pdf_path || manifest?.pdf?.path || "",
      pdfSha256: source.pdf_sha256 || manifest?.pdf?.sha256 || "",
      textPath: source.text_path || manifest?.text?.path || "",
      textSha256: source.text_sha256 || "",
      pageCount: manifest?.pdf?.pages || manifest?.text?.pages || null,
      provenance: versionProvenance,
    });
    const summary = summaryPaper?.summary || version.summary || "";
    if (summaryPaper && (!preferredSummaryArtifact || (version.date || "") > preferredSummaryDate)) {
      preferredWorkSummary = summary;
      preferredSummaryDate = version.date || "";
      preferredSummaryArtifact = summaryArtifact;
    }
    const authors = authorsFor(workSlug, version);
    addObject({
      id: publicationId,
      kind: "publication",
      label: version.title || publication.title,
      description: summary,
      properties: withProvenance({
        work_id: workId,
        year: yearFrom(version.date),
        date: version.date || "",
        venue: version.name || "",
        doi,
        url: versionURL(version),
        aliases: [doi, versionURL(version)].filter(Boolean),
        authors,
        document_id: documentId,
        summary_claim_ids: summaryPaper?.claims || [],
        identifiers: [
          doi ? { namespace: "doi", value: doi } : null,
          versionURL(version) ? { namespace: "url", value: versionURL(version) } : null,
          { namespace: "local", value: publicationId },
        ].filter(Boolean),
      }, versionProvenance),
    });
    addConnection({
      id: `connection:${publicationId}--${workId}`,
      source: publicationId,
      target: workId,
      statement: `${version.date || "This publication"} is a version of ${publication.title}.`,
      evidence: [],
      properties: withProvenance({}, versionProvenance),
    });
    addAcceptedClaims({ paper: claimsPaper, publicationId, workId, documentId });
    for (const claimId of summaryPaper.claims || []) {
      requirePublicationClaim(claimId, publicationId, `Summary for ${rawVersionId}`);
    }
    addAcceptedResults({ paper: resultsPaper, publicationId, workId });
    authors.forEach((author, index) => {
      const target = addPerson(author, artifacts.authors);
      addConnection({
        id: `connection:${publicationId}--${target}--author-${index + 1}`,
        source: publicationId,
        target,
        statement: `${author.name} is an author of ${version.title || publication.title}.`,
        evidence: [],
        properties: withProvenance(
          { author_position: index + 1 },
          artifacts.authors
        ),
      });
    });
    versionIds.push(publicationId);
    ownedPublicationByVersionId.set(rawVersionId, {
      workId,
      publicationId,
      documentId,
      claimsPaper,
      resultsPaper,
      summaryPaper,
      referencesPaper,
    });
    if (doi) {
      ownedVersionsByDoi.set(doi, [...(ownedVersionsByDoi.get(doi) || []), publicationId]);
    }
  }

  addObject({
    id: workId,
    kind: "work",
    label: publication.title,
    description: preferredWorkSummary,
    properties: withProvenance({
      collection: "my_work",
      slug: workSlug,
      aliases: [workSlug],
      version_ids: versionIds,
      identifiers: [{ namespace: "local", value: workId }],
    }, provenanceRefs(artifacts.publications, preferredSummaryArtifact)),
  });
  ownedWorkBySlug.set(workSlug, workId);
  ownedVersionsByTitle.set(titleKey(publication.title), versionIds);
}

const checklistByUrl = new Map();
const checklistByTitleYear = new Map();
const checklistById = new Map();
for (const item of citedChecklist.items || []) {
  checklistById.set(item.id, item);
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

function latestVersion(ids) {
  return [...ids].sort((a, b) => {
    const left = objects.get(a)?.properties?.date || "";
    const right = objects.get(b)?.properties?.date || "";
    return right.localeCompare(left);
  })[0];
}

const citingByKey = new Map();
const citingByPaperId = new Map();

function ensureCiting(row) {
  const checklist = (row.paper_id && checklistById.get(row.paper_id)) || checklistFor(row);
  const doi = normalizeDoi(row.link);
  const ownedIds = doi
    ? ownedVersionsByDoi.get(doi)
    : ownedVersionsByTitle.get(titleKey(row.title));
  if (ownedIds?.length) {
    const publicationId = latestVersion(ownedIds);
    const result = {
      workId: objects.get(publicationId).properties.work_id,
      publicationId,
      documentId: objects.get(publicationId).properties.document_id,
    };
    if (checklist?.id) citingByPaperId.set(checklist.id, result);
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
  const citingProvenance = provenanceRefs(
    artifacts.citations,
    checklist ? artifacts.citedChecklist : ""
  );
  const pdfPath =
    checklist?.available_pdf_path ||
    (checklist?.pdf_status === "present" ? checklist.pdf_path : "") ||
    "";
  const textPath = checklist?.text_path || "";
  const documentId = addDocument({
    id: checklist?.id || `citing-${slug}`,
    publicationId,
    kind: "citing_work",
    pdfPath,
    pdfSha256: "",
    textPath,
    textSha256: "",
    pageCount: null,
    provenance: citingProvenance,
  });
  const summary = row.summary || "";
  addObject({
    id: workId,
    kind: "work",
    label: cleanTitle(row.title),
    description: summary,
    properties: withProvenance({
      collection: "citing_work",
      slug,
      aliases: [slug],
      version_ids: [publicationId],
      identifiers: [{ namespace: "local", value: workId }],
    }, citingProvenance),
  });
  addObject({
    id: publicationId,
    kind: "publication",
    label: cleanTitle(row.title),
    description: summary,
    properties: withProvenance({
      work_id: workId,
      year: Number.isInteger(row.year) ? row.year : yearFrom(row.year),
      date: row.year ? String(row.year) : "",
      venue: "",
      doi,
      url: row.link || "",
      aliases: [doi, row.link].filter(Boolean),
      authors: [],
      document_id: documentId,
      identifiers: [
        doi ? { namespace: "doi", value: doi } : null,
        row.link ? { namespace: "url", value: row.link } : null,
        { namespace: "local", value: publicationId },
      ].filter(Boolean),
    }, citingProvenance),
  });
  addConnection({
    id: `connection:${publicationId}--${workId}`,
    source: publicationId,
    target: workId,
    statement: "This publication is the indexed version of the citing work.",
    evidence: [],
    properties: withProvenance({}, citingProvenance),
  });
  const result = { workId, publicationId, documentId };
  citingByKey.set(key, result);
  if (checklist?.id) citingByPaperId.set(checklist.id, result);
  return result;
}

for (const claimsPaper of acceptedClaims?.papers || []) {
  if (ownedPublicationByVersionId.has(claimsPaper.input?.version_id)) continue;
  const resultsPaper = resultIndexes.byId.get(claimsPaper.id);
  const summaryPaper = summaryIndexes.byId.get(claimsPaper.id);
  const referencesPaper = referenceIndexes.byId.get(claimsPaper.id);
  if (!resultsPaper || !summaryPaper || !referencesPaper) {
    throw new Error(`External paper ${claimsPaper.id} is missing a complete accepted task set`);
  }

  const claimsArtifact = taskArtifact("claims", claimsPaper);
  for (const [taskId, paper] of [
    ["results", resultsPaper],
    ["summary", summaryPaper],
    ["references", referencesPaper],
  ]) {
    if (paper.provenance?.source_claims_artifact !== claimsArtifact) {
      throw new Error(`${taskId} artifact for ${claimsPaper.id} has stale claims lineage`);
    }
  }

  const citing = ensureCiting({
    paper_id: claimsPaper.id,
    title: claimsPaper.input.title,
    year: claimsPaper.input.year,
    link: claimsPaper.input.source_url || claimsPaper.input.doi,
    summary: summaryPaper.summary,
  });
  const taskProvenance = provenanceRefs(
    claimsArtifact,
    taskArtifact("results", resultsPaper),
    taskArtifact("summary", summaryPaper),
    taskArtifact("references", referencesPaper)
  );
  const documentId = addDocument({
    id: claimsPaper.id,
    publicationId: citing.publicationId,
    kind: "citing_work",
    pdfPath: claimsPaper.source?.pdf_path || "",
    pdfSha256: claimsPaper.source?.pdf_sha256 || "",
    textPath: claimsPaper.source?.text_path || "",
    textSha256: claimsPaper.source?.text_sha256 || "",
    pageCount: null,
    provenance: taskProvenance,
  });
  citing.documentId = documentId || citing.documentId;
  citingByPaperId.set(claimsPaper.id, citing);

  const work = objects.get(citing.workId);
  const publication = objects.get(citing.publicationId);
  work.description = summaryPaper.summary;
  publication.description = summaryPaper.summary;
  work.properties = mergeProvenanceProperties(
    work.properties,
    withProvenance({}, taskProvenance)
  );
  publication.properties = mergeProvenanceProperties(
    publication.properties,
    withProvenance({
      document_id: citing.documentId,
      summary_claim_ids: summaryPaper.claims || [],
    }, taskProvenance)
  );

  addAcceptedClaims({
    paper: claimsPaper,
    publicationId: citing.publicationId,
    workId: citing.workId,
    documentId: citing.documentId,
  });
  for (const claimId of summaryPaper.claims || []) {
    requirePublicationClaim(claimId, citing.publicationId, `Summary for ${claimsPaper.id}`);
  }
  addAcceptedResults({
    paper: resultsPaper,
    publicationId: citing.publicationId,
    workId: citing.workId,
  });
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
      properties: withProvenance(
        { source_work_id: citing.workId },
        artifacts.citations
      ),
    });
  }
}

const sourceCatalog = sourceWorkCatalogByDoi();
for (const paper of acceptedReferences?.papers || []) {
  const provenance = taskArtifact("references", paper);
  const citing = paper.input.version_id
    ? ownedPublicationByVersionId.get(paper.input.version_id)
    : citingByPaperId.get(paper.id);
  if (!citing) throw new Error(`Accepted references do not map to a publication: ${paper.id}`);

  for (const [index, reference] of (paper.references || []).entries()) {
    if (reference.status !== "used") continue;
    const doi = normalizeDoi(reference.doi);
    const catalogTarget = doi ? sourceCatalog.get(doi) : null;
    const titleMatches =
      !String(reference.title || "").trim() ||
      catalogTarget?.titles?.some((title) => titlesPlausiblyMatch(reference.title, title));
    let targetWorkId = catalogTarget && titleMatches
      ? ownedWorkBySlug.get(catalogTarget.work_slug)
      : null;
    let candidateVersions = doi ? ownedVersionsByDoi.get(doi) || [] : [];

    if (!targetWorkId && reference.title) {
      candidateVersions = ownedVersionsByTitle.get(titleKey(reference.title)) || [];
      targetWorkId = candidateVersions.length
        ? objects.get(candidateVersions[0])?.properties?.work_id
        : null;
    }
    if (!targetWorkId) continue;

    addConnection({
      id: `connection:citation:${compactSlug(`${citing.publicationId} ${targetWorkId}`, 180)}`,
      source: citing.publicationId,
      target: targetWorkId,
      statement: `${objects.get(citing.workId).label} cites ${objects.get(targetWorkId).label}.`,
      evidence: [],
      properties: withProvenance({ source_work_id: citing.workId }, provenance),
    });

    const targetId = candidateVersions.length === 1 ? candidateVersions[0] : targetWorkId;
    const evidence = groundedEvidence(reference.evidence, citing.documentId);
    if (!evidence.length) continue;
    for (const claimId of reference.claims || []) {
      requirePublicationClaim(
        claimId,
        citing.publicationId,
        `Reference ${reference.ref}`
      );
      const connectionId = `connection:${claimId}--${targetId}`;
      const existingConnection = connections.get(connectionId);
      if (existingConnection) {
        appendUnique(existingConnection.properties.cited_as, reference.ref || String(index + 1));
        appendUnique(existingConnection.properties.cited_dois, doi);
        existingConnection.evidence = mergeEvidence(existingConnection.evidence, evidence);
        continue;
      }
      addConnection({
        id: connectionId,
        source: claimId,
        target: targetId,
        statement: `${objects.get(targetWorkId).label} is cited in support of this claim.`,
        evidence,
        properties: withProvenance({
          source_work_id: citing.workId,
          source_publication_id: citing.publicationId,
          target_work_id: targetWorkId,
          cited_as: [reference.ref || String(index + 1)],
          cited_dois: doi ? [doi] : [],
        }, provenance),
      });
    }
  }
}

const resourceIndex = {
  schema_version: "resource-index-v0",
  recipe: {
    id: "scientific-literature",
    version: recipe.version,
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
