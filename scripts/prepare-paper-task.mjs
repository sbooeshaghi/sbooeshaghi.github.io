#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDoi,
  readJSON,
  rootPath,
} from "../tools/sciindex/bundles/scientific-literature/tasks/paper/lib/common.mjs";
import { writeInputPackets } from "../tools/sciindex/bundles/scientific-literature/tasks/paper/lib/packets.mjs";
import { sourceWorkDoiCatalog } from "./lib/source-work-catalog.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function help() {
  console.log(`Usage:
  node scripts/prepare-paper-task.mjs --works
  node scripts/prepare-paper-task.mjs --work=VERSION_ID
  node scripts/prepare-paper-task.mjs --cited-by-id=CHECKLIST_ID

Options:
  --out-dir=PATH      Default: local/sciindex/paper/inputs
  --source-dir=PATH   Default: local/sciindex/paper/sources`);
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--works") args.works = true;
    else if (arg.startsWith("--work=")) {
      args.workIds = [...(args.workIds || []), arg.slice("--work=".length)];
    } else if (arg.startsWith("--cited-by-id=")) {
      args.citedIds = [...(args.citedIds || []), arg.slice("--cited-by-id=".length)];
    } else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg.startsWith("--source-dir=")) args.sourceDir = arg.slice("--source-dir=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function sourceWorkPapers() {
  const manifest = readJSON(rootPath("db", "pdf-manifest.local.json"), {
    source_work_versions: [],
  });
  return (manifest.source_work_versions || [])
    .filter((item) => item.pdf?.path)
    .map((item) => ({
      id: item.version_id,
      title: item.title,
      year: Number(String(item.date || "").match(/\d{4}/)?.[0]) || null,
      doi: normalizeDoi(item.version_url),
      source_url: item.version_url || "",
      pdf: item.pdf.path,
      work_slug: item.work_slug,
      version_id: item.version_id,
    }));
}

function citedPaper(id) {
  const checklist = readJSON(
    rootPath("local", "citation-context", "cited-by-pdf-checklist.local.json"),
    { items: [] }
  );
  const item = checklist.items?.find((entry) => entry.id === id);
  if (!item) throw new Error(`No cited-by checklist item found for ${id}`);
  if (!item.available_pdf_path) throw new Error(`No PDF is available for ${id}`);
  return {
    id: item.id,
    title: item.title,
    year: item.year,
    doi: normalizeDoi(item.source_url),
    source_url: item.source_url,
    pdf: item.available_pdf_path,
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  help();
  process.exit(0);
}

const allWorks = sourceWorkPapers();
const papers = [
  ...(args.works ? allWorks : []),
  ...allWorks.filter((paper) => (args.workIds || []).includes(paper.version_id)),
  ...(args.citedIds || []).map(citedPaper),
];
const uniquePapers = [...new Map(papers.map((paper) => [paper.id, paper])).values()];
if (!uniquePapers.length) {
  help();
  process.exit(1);
}

const { written } = writeInputPackets(uniquePapers, {
  outDir: args.outDir || "local/sciindex/paper/inputs",
  sourceDir: args.sourceDir || "local/sciindex/paper/sources",
  catalog: sourceWorkDoiCatalog(),
});

for (const filePath of written) {
  console.log(`Wrote ${path.relative(rootDir, filePath)}`);
}
