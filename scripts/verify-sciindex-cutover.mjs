#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recipeHash } from "../tools/sciindex/bundles/scientific-literature/lib/common.mjs";
import { taskHash as claimsTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/claims/lib/common.mjs";
import { taskHash as resultsTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/results/lib/common.mjs";
import { taskHash as summaryTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/summary/lib/common.mjs";
import { taskHash as referencesTaskHash } from "../tools/sciindex/bundles/scientific-literature/tasks/references/lib/common.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  sources: "local/sciindex/source/inputs/index.json",
  claims: "local/sciindex/claims/accepted.json",
  results: "local/sciindex/results/accepted.json",
  summary: "local/sciindex/summary/accepted.json",
  references: "local/sciindex/references/accepted.json",
};

for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--(sources|claims|results|summary|references)=(.+)$/);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  paths[match[1]] = match[2];
}

function read(relativePath) {
  const filePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`Missing required artifact: ${relativePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function paperIdentity(paper) {
  return {
    id: paper?.id || "",
    title: paper?.title || "",
    year: paper?.year ?? null,
    doi: paper?.doi || "",
    source_url: paper?.source_url || "",
    work_slug: paper?.work_slug || "",
    version_id: paper?.version_id || "",
  };
}

function acceptedPaperIdentity(paper) {
  return paperIdentity({ id: paper?.id, ...(paper?.input || {}) });
}

const sourceIndex = read(paths.sources);
if (sourceIndex.schema_version !== "sciindex-source-index-v0") {
  throw new Error("Source index has an invalid schema");
}
if (sourceIndex.recipe_sha256 !== recipeHash()) {
  throw new Error("Source index is stale for the current recipe");
}

const sourcePapers = new Map();
for (const inputPath of sourceIndex.inputs || []) {
  const packet = read(inputPath);
  const paperId = packet?.paper?.id;
  if (!paperId) throw new Error(`Source packet has no paper id: ${inputPath}`);
  if (sourcePapers.has(paperId)) throw new Error(`Duplicate source paper id: ${paperId}`);
  sourcePapers.set(paperId, packet.paper);
}
if (!sourcePapers.size) throw new Error("Source index contains no papers");

const taskDefinitions = {
  claims: { hash: claimsTaskHash(), artifact: read(paths.claims) },
  results: { hash: resultsTaskHash(), artifact: read(paths.results) },
  summary: { hash: summaryTaskHash(), artifact: read(paths.summary) },
  references: { hash: referencesTaskHash(), artifact: read(paths.references) },
};

const papersByTask = new Map();
for (const [taskId, definition] of Object.entries(taskDefinitions)) {
  const artifact = definition.artifact;
  if (
    artifact.schema_version !== "sciindex-accepted-v0" ||
    artifact.bundle_id !== "scientific-literature" ||
    artifact.task_id !== taskId ||
    artifact.recipe_sha256 !== recipeHash() ||
    artifact.task_sha256 !== definition.hash
  ) {
    throw new Error(`Accepted ${taskId} artifact is invalid or stale`);
  }
  const papers = new Map();
  for (const paper of artifact.papers || []) {
    if (!paper?.id || papers.has(paper.id)) {
      throw new Error(`Accepted ${taskId} artifact has a missing or duplicate paper id`);
    }
    papers.set(paper.id, paper);
  }
  const missing = [...sourcePapers.keys()].filter((id) => !papers.has(id));
  const extra = [...papers.keys()].filter((id) => !sourcePapers.has(id));
  if (missing.length || extra.length) {
    throw new Error(
      `${taskId} coverage mismatch: ${missing.length} missing, ${extra.length} extra`
    );
  }
  papersByTask.set(taskId, papers);
}

const claimsPapers = papersByTask.get("claims");
for (const paperId of sourcePapers.keys()) {
  const source = sourcePapers.get(paperId);
  const claimsPaper = claimsPapers.get(paperId);
  const expectedIdentity = paperIdentity(source);
  if (JSON.stringify(acceptedPaperIdentity(claimsPaper)) !== JSON.stringify(expectedIdentity)) {
    throw new Error(`Claims paper identity mismatch for ${paperId}`);
  }
  const claimIds = new Set((claimsPaper.claims || []).map((claim) => claim.id));
  if (!claimIds.size) throw new Error(`Accepted claims are empty for ${paperId}`);
  const claimsArtifact = claimsPaper.provenance?.artifact_id;

  for (const taskId of ["results", "summary", "references"]) {
    const paper = papersByTask.get(taskId).get(paperId);
    if (JSON.stringify(acceptedPaperIdentity(paper)) !== JSON.stringify(expectedIdentity)) {
      throw new Error(`${taskId} paper identity mismatch for ${paperId}`);
    }
    if (paper.provenance?.source_claims_artifact !== claimsArtifact) {
      throw new Error(`${taskId} lineage does not match accepted claims for ${paperId}`);
    }
  }

  for (const result of papersByTask.get("results").get(paperId).results || []) {
    if (result.claims.length < 2 || result.claims.some((id) => !claimIds.has(id))) {
      throw new Error(`Result has invalid claim support for ${paperId}`);
    }
  }
  const summary = papersByTask.get("summary").get(paperId);
  if (!summary.summary || !(summary.claims || []).length || summary.claims.some((id) => !claimIds.has(id))) {
    throw new Error(`Summary has invalid claim support for ${paperId}`);
  }
  for (const reference of papersByTask.get("references").get(paperId).references || []) {
    if ((reference.claims || []).some((id) => !claimIds.has(id))) {
      throw new Error(`Reference ${reference.ref || ""} links an invalid claim for ${paperId}`);
    }
  }
}

console.log(
  `Verified full sciindex cutover: ${sourcePapers.size} papers with claims, results, summaries, and references.`
);
