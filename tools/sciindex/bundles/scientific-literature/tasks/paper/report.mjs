#!/usr/bin/env node

import {
  parseArgs,
  readJSON,
  resolveRootPath,
} from "./lib/common.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/paper/report.mjs --validation=REPORT.json

Options:
  --format=json|md   Default: md`);
}

function rowsFromValidation(report) {
  if (Array.isArray(report.results)) return report.results;
  return [report];
}

function markdownReport(report) {
  const rows = rowsFromValidation(report);
  const lines = [];

  lines.push("| Paper | Valid | Refs | Used | Unresolved | Catalog used | Evidence | Failed |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");

  for (const row of rows) {
    lines.push(
        `| ${String(row.paper || "").replaceAll("|", "\\|")} | ${row.valid ? "yes" : "no"} | ${row.references || 0} | ${row.used_references || 0} | ${row.unresolved_references || 0} | ${row.known_source_work_contexts || 0} | ${row.evidence || 0} | ${(row.failed_evidence || 0) + (row.schema_failures || 0) + (row.provenance_failures || 0) + (row.semantic_failures || 0)} |`
    );
  }

  const knownRows = rows.flatMap((row) =>
    (row.known_source_works || []).map((work) => ({
      paper: row.paper,
      ...work,
    }))
  );

  if (knownRows.length) {
    lines.push("");
    lines.push("| Paper | Catalog DOI | Catalog work | Status | Evidence |");
    lines.push("|---|---|---|---|---:|");

    for (const row of knownRows) {
      lines.push(
        `| ${String(row.paper || "").replaceAll("|", "\\|")} | ${row.doi} | ${String(row.work_title || "").replaceAll("|", "\\|")} | ${row.status || ""} | ${row.evidence_count || 0} |`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

const parsed = parseArgs(process.argv.slice(2), {
  "--validation": (args, value) => {
    args.validation = value;
  },
  "--format": (args, value) => {
    args.format = value;
  },
  help,
});

if (!parsed.validation) {
  help();
  process.exit(1);
}

const report = readJSON(resolveRootPath(parsed.validation));
if (!report) throw new Error(`Could not read validation report: ${parsed.validation}`);

if ((parsed.format || "md") === "json") {
  console.log(JSON.stringify(report, null, 2));
} else {
  process.stdout.write(markdownReport(report));
}
