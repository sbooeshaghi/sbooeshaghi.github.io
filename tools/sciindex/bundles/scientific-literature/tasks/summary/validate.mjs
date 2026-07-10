#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  readJSON,
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256File,
  taskHash,
  writeJSON,
} from "./lib/common.mjs";
import { isArtifactRef } from "../../../../provenance.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/summary/validate.mjs --input=INPUT.json --output=OUTPUT.json
  node tools/sciindex/bundles/scientific-literature/tasks/summary/validate.mjs --input-dir=INPUTS --output-dir=OUTPUTS

Options:
  --report=PATH   Default: local/sciindex/summary/reports/validation.json`);
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

function validatePair(inputPath, outputPath) {
  const input = readJSON(inputPath);
  const output = readJSON(outputPath);
  const failures = [];
  const provenance = input?.provenance || {};
  if (provenance.bundle_id !== "scientific-literature") failures.push({ path: "$.provenance.bundle_id", reason: "bundle_mismatch" });
  if (provenance.recipe_sha256 !== recipeHash()) failures.push({ path: "$.provenance.recipe_sha256", reason: "recipe_hash_mismatch" });
  if (provenance.task_id !== "summary") failures.push({ path: "$.provenance.task_id", reason: "task_mismatch" });
  if (provenance.task_sha256 !== taskHash()) failures.push({ path: "$.provenance.task_sha256", reason: "task_hash_mismatch" });
  const claimsPath = provenance.source_claims_path ? resolveRootPath(provenance.source_claims_path) : "";
  if (!claimsPath || !fs.existsSync(claimsPath)) failures.push({ path: "$.provenance.source_claims_path", reason: "claims_artifact_missing" });
  else if (sha256File(claimsPath) !== provenance.source_claims_sha256) failures.push({ path: "$.provenance.source_claims_sha256", reason: "claims_artifact_hash_mismatch" });
  if (!isArtifactRef(provenance.source_claims_artifact) || !provenance.source_claims_artifact.startsWith("artifact:claims:")) failures.push({ path: "$.provenance.source_claims_artifact", reason: "invalid_claims_artifact" });
  if (claimsPath && fs.existsSync(claimsPath)) {
    const accepted = readJSON(claimsPath);
    const paper = (accepted?.papers || []).find((candidate) => candidate.id === input?.paper?.id);
    if (!paper) failures.push({ path: "$.paper.id", reason: "paper_missing_from_claims_artifact" });
    else {
      if (JSON.stringify(paperIdentity(input.paper)) !== JSON.stringify(acceptedPaperIdentity(paper))) failures.push({ path: "$.paper", reason: "paper_identity_mismatch" });
      if (paper.provenance?.artifact_id !== provenance.source_claims_artifact) failures.push({ path: "$.provenance.source_claims_artifact", reason: "claims_artifact_paper_mismatch" });
      const expected = (paper.claims || []).map(({ id, statement }) => ({ id, statement }));
      if (JSON.stringify(input.claims || []) !== JSON.stringify(expected)) failures.push({ path: "$.claims", reason: "claims_packet_mismatch" });
    }
  }

  if (!output || typeof output !== "object" || Array.isArray(output)) failures.push({ path: "$", reason: "output_must_be_object" });
  else {
    for (const key of Object.keys(output)) if (!["summary", "claims"].includes(key)) failures.push({ path: `$.${key}`, reason: "unexpected_property" });
    if (typeof output.summary !== "string" || !output.summary.trim()) failures.push({ path: "$.summary", reason: "must_be_nonempty_string" });
    if (!Array.isArray(output.claims) || !output.claims.length) failures.push({ path: "$.claims", reason: "must_be_nonempty_array" });
    else {
      const known = new Set((input.claims || []).map((claim) => claim.id));
      const seen = new Set();
      output.claims.forEach((id, index) => {
        if (typeof id !== "string" || !id.trim()) failures.push({ path: `$.claims[${index}]`, reason: "must_be_nonempty_string" });
        else if (!known.has(id)) failures.push({ path: `$.claims[${index}]`, reason: "unknown_claim_id" });
        if (seen.has(id)) failures.push({ path: `$.claims[${index}]`, reason: "duplicate_claim_id" });
        seen.add(id);
      });
    }
  }
  return {
    input: path.relative(rootPath(), inputPath),
    output: path.relative(rootPath(), outputPath),
    paper_id: input?.paper?.id || "",
    paper: input?.paper?.title || "",
    selected_claims: output?.claims?.length || 0,
    input_sha256: sha256File(inputPath),
    output_sha256: sha256File(outputPath),
    source_claims_path: provenance.source_claims_path || "",
    source_claims_sha256: provenance.source_claims_sha256 || "",
    valid: failures.length === 0,
    failures,
  };
}

function outputPathForInput(inputPath, outputDir) {
  return path.join(outputDir, `${path.basename(inputPath, ".json").replace(/\.input$/, "")}.json`);
}
const parsed = parseArgs(process.argv.slice(2), {
  "--input": (args, value) => { args.input = value; },
  "--output": (args, value) => { args.output = value; },
  "--input-dir": (args, value) => { args.inputDir = value; },
  "--output-dir": (args, value) => { args.outputDir = value; },
  "--report": (args, value) => { args.report = value; },
  help,
});
let pairs = [];
if (parsed.input && parsed.output) pairs = [[resolveRootPath(parsed.input), resolveRootPath(parsed.output)]];
else if (parsed.inputDir && parsed.outputDir) {
  const inputDir = resolveRootPath(parsed.inputDir);
  const outputDir = resolveRootPath(parsed.outputDir);
  pairs = fs.readdirSync(inputDir).filter((name) => name.endsWith(".input.json")).sort().map((name) => [path.join(inputDir, name), outputPathForInput(path.join(inputDir, name), outputDir)]);
} else {
  help();
  process.exit(1);
}
const results = pairs.map(([inputPath, outputPath]) =>
  fs.existsSync(outputPath)
    ? validatePair(inputPath, outputPath)
    : { input: path.relative(rootPath(), inputPath), output: path.relative(rootPath(), outputPath), paper: readJSON(inputPath)?.paper?.title || "", selected_claims: 0, valid: false, failures: [{ reason: "missing_output" }] }
);
const report = {
  schema_version: "sciindex-validation-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "summary",
  task_sha256: taskHash(),
  generated_at: new Date().toISOString(),
  summary: { papers: results.length, valid: results.filter((result) => result.valid).length, invalid: results.filter((result) => !result.valid).length, selected_claims: results.reduce((sum, result) => sum + result.selected_claims, 0) },
  results,
};
writeJSON(resolveRootPath(parsed.report || "local/sciindex/summary/reports/validation.json"), report);
console.log(JSON.stringify(report, null, 2));
if (report.summary.invalid) process.exitCode = 1;
