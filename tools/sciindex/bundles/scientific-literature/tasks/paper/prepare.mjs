#!/usr/bin/env node

import path from "node:path";
import {
  parseArgs,
  readJSON,
  resolveRootPath,
  rootPath,
} from "./lib/common.mjs";
import {
  paperFromPdf,
  writeInputPackets,
} from "./lib/packets.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/paper/prepare.mjs --manifest=PAPERS.json
  node tools/sciindex/bundles/scientific-literature/tasks/paper/prepare.mjs --pdf=local/papers/cited-by/example.pdf

Options:
  --catalog=PATH       Optional JSON array of known identifier aliases.
  --out-dir=PATH       Directory for one input packet per paper.
                       Default: local/sciindex/paper/inputs
  --source-dir=PATH    Directory for retained normalized text.
                       Default: local/sciindex/paper/sources

This command only extracts and hashes source text and packages known DOI aliases.
Reference identification and citation linking are intentionally left to the LLM.`);
}

const parsed = parseArgs(process.argv.slice(2), {
  "--manifest": (args, value) => {
    args.manifest = value;
  },
  "--catalog": (args, value) => {
    args.catalog = value;
  },
  "--pdf": (args, value) => {
    args.pdfs = [...(args.pdfs || []), value];
  },
  "--out-dir": (args, value) => {
    args.outDir = value;
  },
  "--source-dir": (args, value) => {
    args.sourceDir = value;
  },
  help,
});

const papers = [
  ...(parsed.manifest
    ? readJSON(resolveRootPath(parsed.manifest), { papers: [] }).papers || []
    : []),
  ...(parsed.pdfs || []).map((pdf) => paperFromPdf(pdf)),
];

if (!papers.length) {
  help();
  process.exit(1);
}

const outDir = parsed.outDir || "local/sciindex/paper/inputs";
const { written } = writeInputPackets(papers, {
  outDir,
  sourceDir: parsed.sourceDir || "local/sciindex/paper/sources",
  catalog: parsed.catalog
    ? readJSON(resolveRootPath(parsed.catalog), [])
    : [],
});

for (const filePath of written) {
  console.log(`Wrote ${path.relative(rootPath(), resolveRootPath(filePath))}`);
}
