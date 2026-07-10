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
  node tools/sciindex/bundles/scientific-literature/tasks/results/prepare.mjs --claims=local/sciindex/claims/accepted.json

Options:
  --out-dir=PATH   Default: local/sciindex/results/inputs`);
}

const parsed = parseArgs(process.argv.slice(2), {
  "--claims": (args, value) => { args.claims = value; },
  "--out-dir": (args, value) => { args.outDir = value; },
  help,
});
if (!parsed.claims) {
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

const outDir = resolveRootPath(parsed.outDir || "local/sciindex/results/inputs");
fs.mkdirSync(outDir, { recursive: true });
const written = [];
for (const paper of accepted.papers || []) {
  const packet = {
    schema_version: "sciindex-task-input-v0",
    provenance: {
      bundle_id: "scientific-literature",
      recipe_sha256: recipeHash(),
      task_id: "results",
      task_sha256: taskHash(),
      source_claims_path: path.relative(rootPath(), claimsPath),
      source_claims_sha256: sha256File(claimsPath),
      source_claims_artifact: paper.provenance?.artifact_id || "",
    },
    llm_prompt: readText(modulePath("prompt.md")).trim(),
    paper: { id: paper.id, ...paper.input },
    claims: (paper.claims || []).map(({ id, position, statement }) => ({ id, position, statement })),
  };
  if (!packet.claims.length) throw new Error(`Accepted paper has no claims: ${paper.id}`);
  const filePath = path.join(outDir, `${stableSlug(paper.id)}.input.json`);
  writeJSON(filePath, packet);
  written.push(filePath);
}

writeJSON(path.join(outDir, "index.json"), {
  schema_version: "sciindex-task-input-index-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "results",
  task_sha256: taskHash(),
  inputs: written.map((filePath) => path.relative(rootPath(), filePath)),
});
written.forEach((filePath) => console.log(`Wrote ${path.relative(rootPath(), filePath)}`));
