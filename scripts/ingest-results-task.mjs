#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normWhitespace,
  parseArgs,
  readJSON,
  recipeHash,
  resolveRootPath,
  sha256,
  sha256File,
  stableSlug,
  taskHash,
  writeJSON,
} from "../tools/sciindex/bundles/scientific-literature/tasks/results/lib/common.mjs";
import { isArtifactRef } from "../tools/sciindex/provenance.mjs";
import { attachAcceptedArtifactId } from "./lib/accepted-artifact.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function help() {
  console.log(`Usage:
  node scripts/ingest-results-task.mjs --validation-report=REPORT.json

Options:
  --out=PATH   Default: local/sciindex/results/accepted.json`);
}
function assertHash(filePath, expected, label) {
  if (sha256File(filePath) !== expected) throw new Error(`${label} changed after validation: ${filePath}`);
}
function resultId(paperId, result) {
  const signature = `${normWhitespace(result.statement).toLowerCase()}\u0000${[...result.claims].sort().join("\u0001")}`;
  return `result:${stableSlug(paperId, 90)}:${sha256(signature).slice(0, 20)}`;
}

const parsed = parseArgs(process.argv.slice(2), {
  "--validation-report": (args, value) => { args.report = value; },
  "--out": (args, value) => { args.out = value; },
  help,
});
if (!parsed.report) {
  help();
  process.exit(1);
}

const report = readJSON(resolveRootPath(parsed.report));
if (report?.schema_version !== "sciindex-validation-v0" || report?.bundle_id !== "scientific-literature" || report?.task_id !== "results") throw new Error("Validation report belongs to another task");
if (report.recipe_sha256 !== recipeHash() || report.task_sha256 !== taskHash()) throw new Error("Validation report is stale for the current recipe or results task");
if (report.summary?.invalid || !(report.results || []).length) throw new Error("All results outputs must pass validation before ingest");

const papers = report.results.map((validation) => {
  if (!validation.valid) throw new Error(`Invalid results output: ${validation.output}`);
  const inputPath = resolveRootPath(validation.input);
  const outputPath = resolveRootPath(validation.output);
  const claimsPath = resolveRootPath(validation.source_claims_path);
  assertHash(inputPath, validation.input_sha256, "Input");
  assertHash(outputPath, validation.output_sha256, "Output");
  assertHash(claimsPath, validation.source_claims_sha256, "Claims artifact");
  const input = readJSON(inputPath);
  const output = readJSON(outputPath);
  const sourceClaimsArtifact = input.provenance?.source_claims_artifact || "";
  if (!isArtifactRef(sourceClaimsArtifact) || !sourceClaimsArtifact.startsWith("artifact:claims:")) throw new Error(`Invalid claims artifact reference: ${validation.input}`);
  const positions = new Map((input.claims || []).map((claim, index) => [claim.id, claim.position || index + 1]));
  const results = (output.results || []).map((result) => ({
    id: resultId(input.paper.id, result),
    position: Math.min(...result.claims.map((id) => positions.get(id))),
    statement: result.statement,
    claims: result.claims,
  })).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  return attachAcceptedArtifactId("results", {
    id: input.paper.id,
    input: {
      title: input.paper.title,
      year: input.paper.year,
      doi: input.paper.doi,
      source_url: input.paper.source_url,
      work_slug: input.paper.work_slug || "",
      version_id: input.paper.version_id || "",
    },
    results,
    provenance: {
      source_claims_artifact: sourceClaimsArtifact,
      input_sha256: validation.input_sha256,
      output_sha256: validation.output_sha256,
    },
  });
});

const accepted = {
  schema_version: "sciindex-accepted-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "results",
  task_sha256: taskHash(),
  papers: papers.sort((left, right) => left.id.localeCompare(right.id)),
};
const outputPath = resolveRootPath(parsed.out || "local/sciindex/results/accepted.json");
writeJSON(outputPath, accepted);
console.log(`Accepted ${papers.length} papers and ${papers.reduce((sum, paper) => sum + paper.results.length, 0)} results into ${path.relative(rootDir, outputPath)}`);
