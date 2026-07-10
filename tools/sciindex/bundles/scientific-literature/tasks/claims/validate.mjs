#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  normWhitespace,
  parseArgs,
  readJSON,
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256File,
  taskHash,
  writeJSON,
} from "./lib/common.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/claims/validate.mjs --input=INPUT.json --output=OUTPUT.json
  node tools/sciindex/bundles/scientific-literature/tasks/claims/validate.mjs --input-dir=INPUTS --output-dir=OUTPUTS

Options:
  --report=PATH   Default: local/sciindex/claims/reports/validation.json`);
}

function shapeFailures(output) {
  const failures = [];
  const rejectExtraKeys = (value, allowed, objectPath) => {
    for (const key of Object.keys(value || {})) {
      if (!allowed.has(key)) failures.push({ path: `${objectPath}.${key}`, reason: "unexpected_property" });
    }
  };

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [{ path: "$", reason: "output_must_be_object" }];
  }
  rejectExtraKeys(output, new Set(["claims"]), "$");
  if (!Array.isArray(output.claims) || !output.claims.length) {
    failures.push({ path: "$.claims", reason: "must_be_nonempty_array" });
    return failures;
  }

  output.claims.forEach((claim, claimIndex) => {
    const claimPath = `$.claims[${claimIndex}]`;
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      failures.push({ path: claimPath, reason: "must_be_object" });
      return;
    }
    rejectExtraKeys(claim, new Set(["statement", "evidence"]), claimPath);
    if (typeof claim.statement !== "string" || !claim.statement.trim()) {
      failures.push({ path: `${claimPath}.statement`, reason: "must_be_nonempty_string" });
    }
    if (!Array.isArray(claim.evidence) || !claim.evidence.length) {
      failures.push({ path: `${claimPath}.evidence`, reason: "must_be_nonempty_array" });
      return;
    }
    claim.evidence.forEach((item, evidenceIndex) => {
      const evidencePath = `${claimPath}.evidence[${evidenceIndex}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        failures.push({ path: evidencePath, reason: "must_be_object" });
        return;
      }
      rejectExtraKeys(item, new Set(["span", "page"]), evidencePath);
      if (typeof item.span !== "string" || !item.span.trim()) {
        failures.push({ path: `${evidencePath}.span`, reason: "must_be_nonempty_string" });
      }
      if (!Number.isInteger(item.page) || item.page < 1) {
        failures.push({ path: `${evidencePath}.page`, reason: "must_be_positive_integer" });
      }
    });
  });
  return failures;
}

function inputFailures(input) {
  const failures = [];
  const provenance = input?.provenance || {};
  if (provenance.bundle_id !== "scientific-literature") failures.push({ path: "$.provenance.bundle_id", reason: "bundle_mismatch" });
  if (provenance.recipe_sha256 !== recipeHash()) failures.push({ path: "$.provenance.recipe_sha256", reason: "recipe_hash_mismatch" });
  if (provenance.task_id !== "claims") failures.push({ path: "$.provenance.task_id", reason: "task_mismatch" });
  if (provenance.task_sha256 !== taskHash()) failures.push({ path: "$.provenance.task_sha256", reason: "task_hash_mismatch" });

  const textPath = provenance.source_text_path ? resolveRootPath(provenance.source_text_path) : "";
  if (!textPath || !fs.existsSync(textPath)) failures.push({ path: "$.provenance.source_text_path", reason: "source_text_missing" });
  else if (sha256File(textPath) !== provenance.source_text_sha256) failures.push({ path: "$.provenance.source_text_sha256", reason: "source_text_hash_mismatch" });

  const pdfPath = input?.paper?.pdf ? resolveRootPath(input.paper.pdf) : "";
  if (!pdfPath || !fs.existsSync(pdfPath)) failures.push({ path: "$.paper.pdf", reason: "source_pdf_missing" });
  else if (sha256File(pdfPath) !== provenance.source_pdf_sha256) failures.push({ path: "$.provenance.source_pdf_sha256", reason: "source_pdf_hash_mismatch" });
  return failures;
}

function evidenceFailures(input, output) {
  const pages = new Map((input.paper?.pages || []).map((page) => [page.page, normWhitespace(page.text)]));
  const failures = [];
  let exact = 0;
  for (const [claimIndex, claim] of (output?.claims || []).entries()) {
    for (const [evidenceIndex, evidence] of (claim?.evidence || []).entries()) {
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) continue;
      const span = normWhitespace(evidence.span);
      const page = pages.get(evidence.page);
      if (!span) failures.push({ path: `$.claims[${claimIndex}].evidence[${evidenceIndex}].span`, reason: "empty_span" });
      else if (!page) failures.push({ path: `$.claims[${claimIndex}].evidence[${evidenceIndex}].page`, reason: "missing_page" });
      else if (!page.includes(span)) failures.push({ path: `$.claims[${claimIndex}].evidence[${evidenceIndex}].span`, reason: "span_not_found" });
      else exact += 1;
    }
  }
  return { exact, failures };
}

function duplicateFailures(output) {
  const seen = new Map();
  const failures = [];
  for (const [index, claim] of (output?.claims || []).entries()) {
    const evidence = (claim?.evidence || [])
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => `${item.page}\u0000${normWhitespace(item.span)}`)
      .sort()
      .join("\u0001");
    const signature = `${normWhitespace(claim?.statement).toLowerCase()}\u0002${evidence}`;
    if (seen.has(signature)) failures.push({ path: `$.claims[${index}]`, reason: "duplicate_claim", duplicate_of: seen.get(signature) });
    else seen.set(signature, index);
  }
  return failures;
}

export function validateClaims(input, output, { inputPath = "", outputPath = "" } = {}) {
  const schemaFailures = shapeFailures(output);
  const provenanceFailures = inputFailures(input);
  const grounding = evidenceFailures(input, output);
  const duplicates = duplicateFailures(output);
  const failures = [...schemaFailures, ...provenanceFailures, ...grounding.failures, ...duplicates];
  const uniqueSpans = new Set(
    (output?.claims || []).flatMap((claim) =>
      (claim?.evidence || [])
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => `${item.page}\u0000${normWhitespace(item.span)}`)
    )
  );
  return {
    input: inputPath ? path.relative(rootPath(), inputPath) : "",
    output: outputPath ? path.relative(rootPath(), outputPath) : "",
    paper_id: input?.paper?.id || "",
    paper: input?.paper?.title || "",
    claims: output?.claims?.length || 0,
    evidence: (output?.claims || []).reduce((sum, claim) => sum + (claim?.evidence || []).length, 0),
    unique_evidence_spans: uniqueSpans.size,
    exact_evidence: grounding.exact,
    duplicate_claims: duplicates.length,
    input_sha256: inputPath ? sha256File(inputPath) : "",
    output_sha256: outputPath ? sha256File(outputPath) : "",
    source_text_path: input?.provenance?.source_text_path || "",
    source_text_sha256: input?.provenance?.source_text_sha256 || "",
    source_pdf_path: input?.paper?.pdf || "",
    source_pdf_sha256: input?.provenance?.source_pdf_sha256 || "",
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
if (parsed.input && parsed.output) {
  pairs = [[resolveRootPath(parsed.input), resolveRootPath(parsed.output)]];
} else if (parsed.inputDir && parsed.outputDir) {
  const inputDir = resolveRootPath(parsed.inputDir);
  const outputDir = resolveRootPath(parsed.outputDir);
  pairs = fs
    .readdirSync(inputDir)
    .filter((name) => name.endsWith(".input.json"))
    .sort()
    .map((name) => [path.join(inputDir, name), outputPathForInput(path.join(inputDir, name), outputDir)]);
} else {
  help();
  process.exit(1);
}

const results = pairs.map(([inputPath, outputPath]) => {
  if (!fs.existsSync(outputPath)) {
    return { input: path.relative(rootPath(), inputPath), output: path.relative(rootPath(), outputPath), paper: readJSON(inputPath)?.paper?.title || "", claims: 0, evidence: 0, unique_evidence_spans: 0, exact_evidence: 0, duplicate_claims: 0, valid: false, failures: [{ reason: "missing_output" }] };
  }
  return validateClaims(readJSON(inputPath), readJSON(outputPath), { inputPath, outputPath });
});

const report = {
  schema_version: "sciindex-validation-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "claims",
  task_sha256: taskHash(),
  generated_at: new Date().toISOString(),
  summary: {
    papers: results.length,
    valid: results.filter((result) => result.valid).length,
    invalid: results.filter((result) => !result.valid).length,
    claims: results.reduce((sum, result) => sum + result.claims, 0),
    evidence: results.reduce((sum, result) => sum + result.evidence, 0),
    unique_evidence_spans: results.reduce((sum, result) => sum + result.unique_evidence_spans, 0),
    duplicate_claims: results.reduce((sum, result) => sum + result.duplicate_claims, 0),
  },
  results,
};

writeJSON(resolveRootPath(parsed.report || "local/sciindex/claims/reports/validation.json"), report);
console.log(JSON.stringify(report, null, 2));
if (report.summary.invalid) process.exitCode = 1;
