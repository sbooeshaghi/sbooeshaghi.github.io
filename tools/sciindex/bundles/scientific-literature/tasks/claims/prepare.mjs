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
  stableSlug,
  taskHash,
  writeJSON,
} from "./lib/common.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/claims/prepare.mjs --input=SOURCE.input.json
  node tools/sciindex/bundles/scientific-literature/tasks/claims/prepare.mjs --input-dir=local/sciindex/source/inputs

Options:
  --out-dir=PATH   Default: local/sciindex/claims/inputs`);
}

const parsed = parseArgs(process.argv.slice(2), {
  "--input": (args, value) => {
    args.inputs = [...(args.inputs || []), value];
  },
  "--input-dir": (args, value) => {
    args.inputDir = value;
  },
  "--out-dir": (args, value) => {
    args.outDir = value;
  },
  help,
});

const inputPaths = [
  ...(parsed.inputs || []).map(resolveRootPath),
  ...(parsed.inputDir
    ? fs
        .readdirSync(resolveRootPath(parsed.inputDir))
        .filter((name) => name.endsWith(".input.json"))
        .sort()
        .map((name) => path.join(resolveRootPath(parsed.inputDir), name))
    : []),
];

if (!inputPaths.length) {
  help();
  process.exit(1);
}

const outDir = resolveRootPath(parsed.outDir || "local/sciindex/claims/inputs");
fs.mkdirSync(outDir, { recursive: true });
const written = [];

for (const sourcePath of inputPaths) {
  const source = readJSON(sourcePath);
  if (!source?.paper?.pages?.length) {
    throw new Error(`Paper source packet has no pages: ${sourcePath}`);
  }
  const packet = {
    schema_version: "sciindex-task-input-v0",
    provenance: {
      bundle_id: "scientific-literature",
      recipe_sha256: recipeHash(),
      task_id: "claims",
      task_sha256: taskHash(),
      source_pdf_sha256: source.provenance?.source_pdf_sha256 || "",
      source_text_sha256: source.provenance?.source_text_sha256 || "",
      source_text_path: source.provenance?.source_text_path || "",
    },
    llm_prompt: readText(modulePath("prompt.md")).trim(),
    paper: source.paper,
  };
  const filePath = path.join(
    outDir,
    `${stableSlug(source.paper.id || source.paper.title)}.input.json`
  );
  writeJSON(filePath, packet);
  written.push(filePath);
}

writeJSON(path.join(outDir, "index.json"), {
  schema_version: "sciindex-task-input-index-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "claims",
  task_sha256: taskHash(),
  inputs: written.map((filePath) => path.relative(rootPath(), filePath)),
});

written.forEach((filePath) => console.log(`Wrote ${path.relative(rootPath(), filePath)}`));
