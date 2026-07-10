#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normWhitespace,
  parseArgs,
  readJSON,
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256,
  sha256File,
  stableSlug,
  taskHash,
  writeJSON,
} from "../tools/sciindex/bundles/scientific-literature/tasks/claims/lib/common.mjs";
import { attachAcceptedArtifactId } from "./lib/accepted-artifact.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function help() {
  console.log(`Usage:
  node scripts/ingest-claims-task.mjs --validation-report=REPORT.json

Options:
  --out=PATH   Default: local/sciindex/claims/accepted.json`);
}

function assertHash(filePath, expected, label) {
  if (sha256File(filePath) !== expected) {
    throw new Error(`${label} changed after validation: ${filePath}`);
  }
}

function claimId(paperId, claim) {
  const evidence = claim.evidence
    .map((item) => `${item.page}\u0000${normWhitespace(item.span)}`)
    .sort()
    .join("\u0001");
  const signature = `${normWhitespace(claim.statement).toLowerCase()}\u0002${evidence}`;
  return `claim:${stableSlug(paperId, 90)}:${sha256(signature).slice(0, 20)}`;
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

const reportPath = resolveRootPath(parsed.report);
const report = readJSON(reportPath);
if (!report) throw new Error(`Validation report not found: ${reportPath}`);
if (
  report.schema_version !== "sciindex-validation-v0" ||
  report.bundle_id !== "scientific-literature" ||
  report.task_id !== "claims"
) {
  throw new Error("Validation report belongs to another task");
}
if (report.recipe_sha256 !== recipeHash() || report.task_sha256 !== taskHash()) {
  throw new Error("Validation report is stale for the current recipe or claims task");
}
if (report.summary?.invalid || !(report.results || []).length) {
  throw new Error("All claims outputs must pass validation before ingest");
}

const papers = report.results.map((result) => {
  if (!result.valid) throw new Error(`Invalid claims output: ${result.output}`);
  const inputPath = resolveRootPath(result.input);
  const outputPath = resolveRootPath(result.output);
  const textPath = resolveRootPath(result.source_text_path);
  const pdfPath = resolveRootPath(result.source_pdf_path);
  assertHash(inputPath, result.input_sha256, "Input");
  assertHash(outputPath, result.output_sha256, "Output");
  assertHash(textPath, result.source_text_sha256, "Text source");
  assertHash(pdfPath, result.source_pdf_sha256, "PDF source");

  const input = readJSON(inputPath);
  const output = readJSON(outputPath);
  const claims = output.claims.map((claim, index) => ({
    id: claimId(input.paper.id, claim),
    position: index + 1,
    statement: claim.statement,
    evidence: claim.evidence,
  }));
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) {
    throw new Error(`Claims output produces duplicate stable IDs: ${result.output}`);
  }

  return attachAcceptedArtifactId("claims", {
    id: input.paper.id,
    input: {
      title: input.paper.title,
      year: input.paper.year,
      doi: input.paper.doi,
      source_url: input.paper.source_url,
      work_slug: input.paper.work_slug || "",
      version_id: input.paper.version_id || "",
    },
    source: {
      pdf_path: path.relative(rootDir, pdfPath),
      pdf_sha256: result.source_pdf_sha256,
      text_path: path.relative(rootDir, textPath),
      text_sha256: result.source_text_sha256,
    },
    claims,
    provenance: {
      input_sha256: result.input_sha256,
      output_sha256: result.output_sha256,
    },
  });
});

const accepted = {
  schema_version: "sciindex-accepted-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "claims",
  task_sha256: taskHash(),
  papers: papers.sort((left, right) => left.id.localeCompare(right.id)),
};

const outputPath = resolveRootPath(parsed.out || "local/sciindex/claims/accepted.json");
writeJSON(outputPath, accepted);
console.log(`Accepted ${papers.length} papers and ${papers.reduce((sum, paper) => sum + paper.claims.length, 0)} claims into ${path.relative(rootPath(), outputPath)}`);
