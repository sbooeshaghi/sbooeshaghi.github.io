#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  normalizeDoi,
  normWhitespace,
  parseArgs,
  recipeHash,
  readJSON,
  resolveRootPath,
  rootPath,
  sha256File,
  taskHash,
  titlesPlausiblyMatch,
  writeJSON,
} from "./lib/common.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/paper/validate.mjs --input=INPUT.json --output=OUTPUT.json
  node tools/sciindex/bundles/scientific-literature/tasks/paper/validate.mjs --input-dir=local/sciindex/paper/inputs --output-dir=local/sciindex/paper/outputs

Options:
  --report=PATH   Validation report path.
                  Default: local/sciindex/paper/reports/validation.json

Validation checks only:
  - minimal artifact shape
  - exact evidence-span grounding against extracted page text
  - overlap with known source-work DOI aliases`);
}

function shapeFailures(output) {
  const failures = [];

  function rejectExtraKeys(value, allowed, objectPath) {
    for (const key of Object.keys(value || {})) {
      if (!allowed.has(key)) {
        failures.push({ path: `${objectPath}.${key}`, reason: "unexpected_property" });
      }
    }
  }

  function validateEvidenceArray(arrayPath, evidence, { allowEmpty = false } = {}) {
    if (!Array.isArray(evidence)) {
      failures.push({ path: arrayPath, reason: "must_be_array" });
      return;
    }

    if (!allowEmpty && !evidence.length) {
      failures.push({ path: arrayPath, reason: "must_not_be_empty" });
    }

    evidence.forEach((item, index) => {
      const itemPath = `${arrayPath}[${index}]`;

      if (!item || typeof item !== "object" || Array.isArray(item)) {
        failures.push({ path: itemPath, reason: "must_be_object" });
        return;
      }

      rejectExtraKeys(item, new Set(["span", "page"]), itemPath);

      if (typeof item.span !== "string" || !item.span.trim()) {
        failures.push({ path: `${itemPath}.span`, reason: "must_be_nonempty_string" });
      }

      if (!Number.isInteger(item.page) || item.page < 1) {
        failures.push({ path: `${itemPath}.page`, reason: "must_be_positive_integer" });
      }
    });
  }

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [{ path: "$", reason: "output_must_be_object" }];
  }

  rejectExtraKeys(output, new Set(["paper", "references"]), "$" );

  if (!output.paper || typeof output.paper !== "object") {
    failures.push({ path: "$.paper", reason: "missing_object" });
  } else {
    rejectExtraKeys(
      output.paper,
      new Set(["title", "doi", "year", "statement", "evidence"]),
      "$.paper"
    );
    for (const key of ["title", "doi", "statement"]) {
      if (typeof output.paper[key] !== "string") {
        failures.push({ path: `$.paper.${key}`, reason: "must_be_string" });
      }
    }
    for (const key of ["title", "statement"]) {
      if (!String(output.paper[key] || "").trim()) {
        failures.push({ path: `$.paper.${key}`, reason: "must_not_be_empty" });
      }
    }

    if (
      output.paper.year !== null &&
      !Number.isInteger(output.paper.year)
    ) {
      failures.push({ path: "$.paper.year", reason: "must_be_integer_or_null" });
    }

    validateEvidenceArray("$.paper.evidence", output.paper.evidence);
  }

  if (!Array.isArray(output.references)) {
    failures.push({ path: "$.references", reason: "must_be_array" });
  } else if (!output.references.length) {
    failures.push({ path: "$.references", reason: "must_not_be_empty" });
  } else {
    output.references.forEach((ref, refIndex) => {
      if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
        failures.push({
          path: `$.references[${refIndex}]`,
          reason: "must_be_object",
        });
        return;
      }


      rejectExtraKeys(
        ref,
        new Set(["ref", "title", "doi", "year", "status", "statement", "evidence"]),
        `$.references[${refIndex}]`
      );

      for (const key of ["ref", "title", "doi", "statement"]) {
        if (typeof ref[key] !== "string") {
          failures.push({
            path: `$.references[${refIndex}].${key}`,
            reason: "must_be_string",
          });
        }
      }
      if (!String(ref.ref || "").trim()) {
        failures.push({
          path: `$.references[${refIndex}].ref`,
          reason: "must_not_be_empty",
        });
      }

      if (
        ref.year !== null &&
        !Number.isInteger(ref.year)
      ) {
        failures.push({
          path: `$.references[${refIndex}].year`,
          reason: "must_be_integer_or_null",
        });
      }

      if (!["used", "unused_or_unresolved"].includes(ref.status)) {
        failures.push({
          path: `$.references[${refIndex}].status`,
          reason: "must_be_used_or_unused_or_unresolved",
        });
      }

      if (ref.status === "used" && !String(ref.statement || "").trim()) {
        failures.push({
          path: `$.references[${refIndex}].statement`,
          reason: "used_reference_statement_must_not_be_empty",
        });
      }

      if (
        ref.status === "unused_or_unresolved" &&
        String(ref.statement || "").trim()
      ) {
        failures.push({
          path: `$.references[${refIndex}].statement`,
          reason: "unused_reference_statement_must_be_empty",
        });
      }

      if (
        ref.status === "unused_or_unresolved" &&
        Array.isArray(ref.evidence) &&
        ref.evidence.length
      ) {
        failures.push({
          path: `$.references[${refIndex}].evidence`,
          reason: "unused_reference_evidence_must_be_empty",
        });
      }

      validateEvidenceArray(
        `$.references[${refIndex}].evidence`,
        ref.evidence,
        { allowEmpty: ref.status === "unused_or_unresolved" }
      );
    });
  }

  return failures;
}

function inputFailures(input) {
  const failures = [];
  const provenance = input.provenance || {};

  if (provenance.bundle_id !== "scientific-literature") {
    failures.push({ path: "$.provenance.bundle_id", reason: "bundle_mismatch" });
  }
  if (provenance.recipe_sha256 !== recipeHash()) {
    failures.push({ path: "$.provenance.recipe_sha256", reason: "recipe_hash_mismatch" });
  }
  if (provenance.task_id !== "paper") {
    failures.push({ path: "$.provenance.task_id", reason: "task_mismatch" });
  }
  if (provenance.task_sha256 !== taskHash()) {
    failures.push({ path: "$.provenance.task_sha256", reason: "task_hash_mismatch" });
  }

  const textPath = provenance.source_text_path
    ? resolveRootPath(provenance.source_text_path)
    : "";
  if (!textPath || !fs.existsSync(textPath)) {
    failures.push({ path: "$.provenance.source_text_path", reason: "source_text_missing" });
  } else if (sha256File(textPath) !== provenance.source_text_sha256) {
    failures.push({ path: "$.provenance.source_text_sha256", reason: "source_text_hash_mismatch" });
  }

  const pdfPath = input.paper?.pdf ? resolveRootPath(input.paper.pdf) : "";
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    failures.push({ path: "$.paper.pdf", reason: "source_pdf_missing" });
  } else if (sha256File(pdfPath) !== provenance.source_pdf_sha256) {
    failures.push({ path: "$.provenance.source_pdf_sha256", reason: "source_pdf_hash_mismatch" });
  }

  return failures;
}

function collectEvidence(output) {
  const evidence = [];

  for (const item of output.paper?.evidence || []) {
    evidence.push({ label: "paper", item });
  }

  for (const ref of output.references || []) {
    for (const item of ref.evidence || []) {
      evidence.push({ label: normalizeDoi(ref.doi) || ref.ref || "reference", item });
    }
  }

  return evidence;
}

function validateEvidence(input, output) {
  const pages = new Map(
    (input.paper?.pages || []).map((page) => [page.page, normWhitespace(page.text)])
  );
  const failures = [];
  let exact = 0;

  for (const { label, item } of collectEvidence(output)) {
    const pageText = pages.get(item.page);
    const span = normWhitespace(item.span);

    if (!span) {
      failures.push({ label, page: item.page, reason: "empty_span", span });
    } else if (!pageText) {
      failures.push({ label, page: item.page, reason: "missing_page", span });
    } else if (!pageText.includes(span)) {
      failures.push({ label, page: item.page, reason: "span_not_found", span });
    } else {
      exact += 1;
    }
  }

  return { exact, failures };
}

function semanticFailures(output, known) {
  const failures = [];
  const genericStatement = /^(?:cited to support|provides? prior or methodological support|provides? support or context|the paper cites .+ in the surrounding scientific or technical discussion)/i;
  const paperDoi = normalizeDoi(output.paper?.doi);

  for (const [index, ref] of (output.references || []).entries()) {
    if (ref.status === "used") {
      if (genericStatement.test(String(ref.statement || "").trim())) {
        failures.push({
          path: `$.references[${index}].statement`,
          reason: "generic_use_statement",
        });
      }
      for (const [evidenceIndex, evidence] of (ref.evidence || []).entries()) {
        if (normWhitespace(evidence.span).length < 40) {
          failures.push({
            path: `$.references[${index}].evidence[${evidenceIndex}].span`,
            reason: "citation_evidence_too_short",
          });
        }
      }
    }

    const doi = normalizeDoi(ref.doi);
    if (!doi) continue;
    if (
      paperDoi &&
      doi === paperDoi &&
      !titlesPlausiblyMatch(ref.title, output.paper?.title)
    ) {
      failures.push({
        path: `$.references[${index}].doi`,
        reason: "paper_doi_assigned_to_different_reference",
      });
    }

    const knownEntry = known.get(doi);
    if (
      knownEntry &&
      String(ref.title || "").trim() &&
      ![knownEntry.work_title, knownEntry.version_title, ...(knownEntry.titles || [])]
        .filter(Boolean)
        .some((title) =>
        titlesPlausiblyMatch(ref.title, title)
      )
    ) {
      failures.push({
        path: `$.references[${index}].doi`,
        reason: "known_doi_title_mismatch",
      });
    }
  }

  return failures;
}

export function validateCitationContext(input, output, { inputPath = "", outputPath = "" } = {}) {
  const known = new Map(
    (input.source_work_dois || []).map((entry) => [
      normalizeDoi(entry.doi),
      entry,
    ])
  );
  const refs = output.references || [];
  const usedRefs = refs.filter((ref) => ref.status === "used");
  const unresolvedRefs = refs.filter((ref) => ref.status === "unused_or_unresolved");
  const knownRefs = refs
    .filter((ref) => {
      const entry = known.get(normalizeDoi(ref.doi));
      if (!entry) return false;
      if (!String(ref.title || "").trim()) return true;
      return [entry.work_title, entry.version_title, ...(entry.titles || [])]
        .filter(Boolean)
        .some((title) => titlesPlausiblyMatch(ref.title, title));
    })
    .map((ref) => ({
      doi: normalizeDoi(ref.doi),
      work_title: known.get(normalizeDoi(ref.doi)).work_title,
      status: ref.status || "",
      evidence_count: (ref.evidence || []).length,
    }));
  const evidence = collectEvidence(output);
  const evidenceValidation = validateEvidence(input, output);
  const schemaFailures = shapeFailures(output);
  const provenanceFailures = inputFailures(input);
  const meaningFailures = semanticFailures(output, known);
  const failures = [
    ...schemaFailures,
    ...provenanceFailures,
    ...meaningFailures,
    ...evidenceValidation.failures,
  ];

  return {
    input: inputPath ? path.relative(rootPath(), inputPath) : "",
    output: outputPath ? path.relative(rootPath(), outputPath) : "",
    paper: output.paper?.title || input.paper?.title || "",
    references: refs.length,
    used_references: usedRefs.length,
    unresolved_references: unresolvedRefs.length,
    known_source_work_references: knownRefs.length,
    known_source_work_contexts: knownRefs.filter((ref) => ref.status === "used").length,
    evidence: evidence.length,
    exact_evidence: evidenceValidation.exact,
    failed_evidence: evidenceValidation.failures.length,
    input_sha256: inputPath ? sha256File(inputPath) : "",
    output_sha256: outputPath ? sha256File(outputPath) : "",
    source_text_path: input.provenance?.source_text_path || "",
    source_text_sha256: input.provenance?.source_text_sha256 || "",
    source_pdf_path: input.paper?.pdf || "",
    source_pdf_sha256: input.provenance?.source_pdf_sha256 || "",
    schema_failures: schemaFailures.length,
    provenance_failures: provenanceFailures.length,
    semantic_failures: meaningFailures.length,
    valid: failures.length === 0,
    known_source_works: knownRefs,
    failures,
  };
}

function outputPathForInput(inputPath, outputDir) {
  const basename = path.basename(inputPath, ".json").replace(/\.input$/, "");
  return path.join(outputDir, `${basename}.json`);
}

function validatePair(inputPath, outputPath) {
  const input = readJSON(inputPath);
  const output = readJSON(outputPath);
  if (!input) throw new Error(`Could not read input: ${inputPath}`);
  if (!output) throw new Error(`Could not read output: ${outputPath}`);
  return validateCitationContext(input, output, { inputPath, outputPath });
}

const parsed = parseArgs(process.argv.slice(2), {
  "--input": (args, value) => {
    args.input = value;
  },
  "--output": (args, value) => {
    args.output = value;
  },
  "--input-dir": (args, value) => {
    args.inputDir = value;
  },
  "--output-dir": (args, value) => {
    args.outputDir = value;
  },
  "--report": (args, value) => {
    args.report = value;
  },
  help,
});

let results;

if (parsed.input && parsed.output) {
  results = [validatePair(resolveRootPath(parsed.input), resolveRootPath(parsed.output))];
} else if (parsed.inputDir && parsed.outputDir) {
  const inputDir = resolveRootPath(parsed.inputDir);
  const outputDir = resolveRootPath(parsed.outputDir);
  const inputFiles = fs
    .readdirSync(inputDir)
    .filter((fileName) => fileName.endsWith(".json") && fileName !== "index.json")
    .sort()
    .map((fileName) => path.join(inputDir, fileName));

  results = inputFiles.map((inputPath) => {
    const outputPath = outputPathForInput(inputPath, outputDir);

    if (!fs.existsSync(outputPath)) {
      return {
        input: path.relative(rootPath(), inputPath),
        output: path.relative(rootPath(), outputPath),
        paper: readJSON(inputPath)?.paper?.title || "",
      references: 0,
      used_references: 0,
      unresolved_references: 0,
      known_source_work_references: 0,
      known_source_work_contexts: 0,
      evidence: 0,
        exact_evidence: 0,
        failed_evidence: 0,
        schema_failures: 0,
        provenance_failures: 0,
        semantic_failures: 0,
        valid: false,
        known_source_works: [],
        failures: [{ reason: "missing_output" }],
      };
    }

    return validatePair(inputPath, outputPath);
  });
} else {
  help();
  process.exit(1);
}

const report = {
  schema_version: "sciindex-validation-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "paper",
  task_sha256: taskHash(),
  generated_at: new Date().toISOString(),
  summary: {
    papers: results.length,
    valid: results.filter((result) => result.valid).length,
    invalid: results.filter((result) => !result.valid).length,
    references: results.reduce((sum, result) => sum + result.references, 0),
    used_references: results.reduce((sum, result) => sum + result.used_references, 0),
    unresolved_references: results.reduce((sum, result) => sum + result.unresolved_references, 0),
    known_source_work_references: results.reduce((sum, result) => sum + result.known_source_work_references, 0),
    known_source_work_contexts: results.reduce((sum, result) => sum + result.known_source_work_contexts, 0),
    evidence: results.reduce((sum, result) => sum + result.evidence, 0),
    failed_evidence: results.reduce((sum, result) => sum + result.failed_evidence, 0),
    semantic_failures: results.reduce((sum, result) => sum + (result.semantic_failures || 0), 0),
  },
  results,
};

writeJSON(
  resolveRootPath(parsed.report || "local/sciindex/paper/reports/validation.json"),
  report
);

console.log(JSON.stringify(report, null, 2));

if (report.summary.invalid) {
  process.exitCode = 1;
}
