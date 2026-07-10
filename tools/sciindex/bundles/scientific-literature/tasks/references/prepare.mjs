#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  modulePath,
  parseArgs,
  readJSON,
  readText,
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256File,
  stableSlug,
  taskHash,
  writeJSON,
} from "./lib/common.mjs";
import { taskHash as claimsTaskHash } from "../claims/lib/common.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/references/prepare.mjs --source-input=PAPER.input.json --claims=CLAIMS.accepted.json
  node tools/sciindex/bundles/scientific-literature/tasks/references/prepare.mjs --source-input-dir=PAPER_INPUTS --claims=CLAIMS.accepted.json

Options:
  --out-dir=PATH   Default: local/sciindex/references/inputs`);
}

const parsed = parseArgs(process.argv.slice(2), {
  "--source-input": (args, value) => { args.inputs = [...(args.inputs || []), value]; },
  "--source-input-dir": (args, value) => { args.inputDir = value; },
  "--claims": (args, value) => { args.claims = value; },
  "--out-dir": (args, value) => { args.outDir = value; },
  help,
});
if (!parsed.claims) {
  help();
  process.exit(1);
}

const inputPaths = [
  ...(parsed.inputs || []).map(resolveRootPath),
  ...(parsed.inputDir
    ? fs.readdirSync(resolveRootPath(parsed.inputDir)).filter((name) => name.endsWith(".input.json")).sort().map((name) => path.join(resolveRootPath(parsed.inputDir), name))
    : []),
];
if (!inputPaths.length) {
  help();
  process.exit(1);
}

const claimsPath = resolveRootPath(parsed.claims);
const accepted = readJSON(claimsPath);
if (
  accepted?.schema_version !== "sciindex-accepted-v0" ||
  accepted?.bundle_id !== "scientific-literature" ||
  accepted?.task_id !== "claims" ||
  accepted?.recipe_sha256 !== recipeHash() ||
  accepted?.task_sha256 !== claimsTaskHash()
) throw new Error("Claims artifact is invalid or stale");
const claimsByPaper = new Map((accepted.papers || []).map((paper) => [paper.id, paper]));

const outDir = resolveRootPath(parsed.outDir || "local/sciindex/references/inputs");
fs.mkdirSync(outDir, { recursive: true });
const written = [];
for (const sourcePath of inputPaths) {
  const source = readJSON(sourcePath);
  const acceptedPaper = claimsByPaper.get(source?.paper?.id);
  if (!acceptedPaper) throw new Error(`No accepted claims for paper: ${source?.paper?.id || sourcePath}`);
  const packet = {
    schema_version: "sciindex-task-input-v0",
    provenance: {
      bundle_id: "scientific-literature",
      recipe_sha256: recipeHash(),
      task_id: "references",
      task_sha256: taskHash(),
      source_pdf_sha256: source.provenance?.source_pdf_sha256 || "",
      source_text_sha256: source.provenance?.source_text_sha256 || "",
      source_text_path: source.provenance?.source_text_path || "",
      source_claims_path: path.relative(rootPath(), claimsPath),
      source_claims_sha256: sha256File(claimsPath),
      source_claims_artifact: acceptedPaper.provenance?.artifact_id || "",
    },
    llm_prompt: readText(modulePath("prompt.md")).trim(),
    source_work_dois: source.source_work_dois || [],
    paper: source.paper,
    claims: acceptedPaper.claims || [],
  };
  const filePath = path.join(outDir, `${stableSlug(source.paper.id || source.paper.title)}.input.json`);
  writeJSON(filePath, packet);
  written.push(filePath);
}
writeJSON(path.join(outDir, "index.json"), {
  schema_version: "sciindex-task-input-index-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "references",
  task_sha256: taskHash(),
  inputs: written.map((filePath) => path.relative(rootPath(), filePath)),
});
written.forEach((filePath) => console.log(`Wrote ${path.relative(rootPath(), filePath)}`));
