#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  recipeHash,
  readJSON,
  resolveRootPath,
  sha256File,
  taskHash,
  writeJSON,
} from "../tools/sciindex/bundles/scientific-literature/tasks/paper/lib/common.mjs";
import { artifactRef } from "../tools/sciindex/provenance.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function help() {
  console.log(`Usage:
  node scripts/ingest-paper-task.mjs \\
    --validation-report=local/sciindex/paper/reports/validation.json

Options:
  --out=PATH   Accepted artifact path.
               Default: local/sciindex/paper/accepted.json`);
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--validation-report=")) {
      args.report = arg.slice("--validation-report=".length);
    } else if (arg.startsWith("--out=")) {
      args.out = arg.slice("--out=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function assertHash(filePath, expected, label) {
  const actual = sha256File(filePath);
  if (actual !== expected) {
    throw new Error(`${label} changed after validation: ${filePath}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.report) {
  help();
  process.exit(args.help ? 0 : 1);
}

const reportPath = resolveRootPath(args.report);
const report = readJSON(reportPath);
if (!report) throw new Error(`Validation report not found: ${reportPath}`);
if (report.schema_version !== "sciindex-validation-v0") {
  throw new Error("Unsupported validation report");
}
if (report.bundle_id !== "scientific-literature" || report.task_id !== "paper") {
  throw new Error("Validation report belongs to another bundle or task");
}
if (report.recipe_sha256 !== recipeHash() || report.task_sha256 !== taskHash()) {
  throw new Error("Validation report is stale for the current recipe or task");
}
if (report.summary?.invalid || !(report.results || []).length) {
  throw new Error("All task outputs must pass validation before ingest");
}

const papers = report.results.map((result) => {
  if (!result.valid) throw new Error(`Invalid task output: ${result.output}`);

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
  return {
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
    paper: output.paper,
    references: output.references,
    provenance: {
      artifact_id: artifactRef("paper", result.output_sha256),
      input_sha256: result.input_sha256,
      output_sha256: result.output_sha256,
    },
  };
});

const accepted = {
  schema_version: "sciindex-accepted-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: report.recipe_sha256,
  task_id: "paper",
  task_sha256: report.task_sha256,
  papers: papers.sort((a, b) => a.id.localeCompare(b.id)),
};

const outputPath = resolveRootPath(args.out || "local/sciindex/paper/accepted.json");
writeJSON(outputPath, accepted);
console.log(`Accepted ${papers.length} papers into ${path.relative(rootDir, outputPath)}`);
