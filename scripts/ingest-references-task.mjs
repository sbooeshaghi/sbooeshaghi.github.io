#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  readJSON,
  recipeHash,
  resolveRootPath,
  sha256File,
  taskHash,
  writeJSON,
} from "../tools/sciindex/bundles/scientific-literature/tasks/references/lib/common.mjs";
import { isArtifactRef } from "../tools/sciindex/provenance.mjs";
import { attachAcceptedArtifactId } from "./lib/accepted-artifact.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function help() {
  console.log(`Usage:
  node scripts/ingest-references-task.mjs --validation-report=REPORT.json

Options:
  --out=PATH   Default: local/sciindex/references/accepted.json`);
}

function assertHash(filePath, expected, label) {
  if (sha256File(filePath) !== expected) {
    throw new Error(`${label} changed after validation: ${filePath}`);
  }
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
if (
  report?.schema_version !== "sciindex-validation-v0" ||
  report?.bundle_id !== "scientific-literature" ||
  report?.task_id !== "references"
) throw new Error("Validation report belongs to another task");
if (report.recipe_sha256 !== recipeHash() || report.task_sha256 !== taskHash()) {
  throw new Error("Validation report is stale for the current recipe or references task");
}
if (report.summary?.invalid || !(report.results || []).length) {
  throw new Error("All reference outputs must pass validation before ingest");
}

const papers = report.results.map((result) => {
  if (!result.valid) throw new Error(`Invalid references output: ${result.output}`);
  const inputPath = resolveRootPath(result.input);
  const outputPath = resolveRootPath(result.output);
  const textPath = resolveRootPath(result.source_text_path);
  const pdfPath = resolveRootPath(result.source_pdf_path);
  const claimsPath = resolveRootPath(result.source_claims_path);
  assertHash(inputPath, result.input_sha256, "Input");
  assertHash(outputPath, result.output_sha256, "Output");
  assertHash(textPath, result.source_text_sha256, "Text source");
  assertHash(pdfPath, result.source_pdf_sha256, "PDF source");
  assertHash(claimsPath, result.source_claims_sha256, "Claims artifact");

  const input = readJSON(inputPath);
  const output = readJSON(outputPath);
  const sourceClaimsArtifact = input.provenance?.source_claims_artifact || "";
  if (!isArtifactRef(sourceClaimsArtifact) || !sourceClaimsArtifact.startsWith("artifact:claims:")) {
    throw new Error(`Invalid claims artifact reference: ${result.input}`);
  }
  return attachAcceptedArtifactId("references", {
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
    references: output.references,
    provenance: {
      source_claims_artifact: sourceClaimsArtifact,
      input_sha256: result.input_sha256,
      output_sha256: result.output_sha256,
    },
  });
});

const accepted = {
  schema_version: "sciindex-accepted-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "references",
  task_sha256: taskHash(),
  papers: papers.sort((left, right) => left.id.localeCompare(right.id)),
};
const outputPath = resolveRootPath(parsed.out || "local/sciindex/references/accepted.json");
writeJSON(outputPath, accepted);
console.log(`Accepted ${papers.length} reference inventories into ${path.relative(rootDir, outputPath)}`);
