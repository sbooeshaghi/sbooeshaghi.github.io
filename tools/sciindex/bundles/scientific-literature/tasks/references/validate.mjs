#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  normalizeDoi,
  normWhitespace,
  parseArgs,
  readJSON,
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256File,
  taskHash,
  titlesPlausiblyMatch,
  writeJSON,
} from "./lib/common.mjs";
import { isArtifactRef } from "../../../../provenance.mjs";

function help() {
  console.log(`Usage:
  node tools/sciindex/bundles/scientific-literature/tasks/references/validate.mjs --input=INPUT.json --output=OUTPUT.json
  node tools/sciindex/bundles/scientific-literature/tasks/references/validate.mjs --input-dir=INPUTS --output-dir=OUTPUTS

Options:
  --report=PATH   Default: local/sciindex/references/reports/validation.json`);
}

function paperIdentity(paper) {
  return {
    id: paper?.id || "",
    title: paper?.title || "",
    year: paper?.year ?? null,
    doi: paper?.doi || "",
    source_url: paper?.source_url || "",
    work_slug: paper?.work_slug || "",
    version_id: paper?.version_id || "",
  };
}

function acceptedPaperIdentity(paper) {
  return paperIdentity({ id: paper?.id, ...(paper?.input || {}) });
}

function spansOverlap(left, right) {
  const a = normWhitespace(left);
  const b = normWhitespace(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function validatePair(inputPath, outputPath) {
  const input = readJSON(inputPath);
  const output = readJSON(outputPath);
  const failures = [];
  const provenance = input?.provenance || {};
  if (provenance.bundle_id !== "scientific-literature") failures.push({ path: "$.provenance.bundle_id", reason: "bundle_mismatch" });
  if (provenance.recipe_sha256 !== recipeHash()) failures.push({ path: "$.provenance.recipe_sha256", reason: "recipe_hash_mismatch" });
  if (provenance.task_id !== "references") failures.push({ path: "$.provenance.task_id", reason: "task_mismatch" });
  if (provenance.task_sha256 !== taskHash()) failures.push({ path: "$.provenance.task_sha256", reason: "task_hash_mismatch" });
  const textPath = provenance.source_text_path ? resolveRootPath(provenance.source_text_path) : "";
  if (!textPath || !fs.existsSync(textPath)) failures.push({ path: "$.provenance.source_text_path", reason: "source_text_missing" });
  else if (sha256File(textPath) !== provenance.source_text_sha256) failures.push({ path: "$.provenance.source_text_sha256", reason: "source_text_hash_mismatch" });
  const pdfPath = input?.paper?.pdf ? resolveRootPath(input.paper.pdf) : "";
  if (!pdfPath || !fs.existsSync(pdfPath)) failures.push({ path: "$.paper.pdf", reason: "source_pdf_missing" });
  else if (sha256File(pdfPath) !== provenance.source_pdf_sha256) failures.push({ path: "$.provenance.source_pdf_sha256", reason: "source_pdf_hash_mismatch" });
  const claimsPath = provenance.source_claims_path ? resolveRootPath(provenance.source_claims_path) : "";
  if (!claimsPath || !fs.existsSync(claimsPath)) failures.push({ path: "$.provenance.source_claims_path", reason: "claims_artifact_missing" });
  else if (sha256File(claimsPath) !== provenance.source_claims_sha256) failures.push({ path: "$.provenance.source_claims_sha256", reason: "claims_artifact_hash_mismatch" });
  if (!isArtifactRef(provenance.source_claims_artifact) || !provenance.source_claims_artifact.startsWith("artifact:claims:")) failures.push({ path: "$.provenance.source_claims_artifact", reason: "invalid_claims_artifact" });
  if (claimsPath && fs.existsSync(claimsPath)) {
    const accepted = readJSON(claimsPath);
    const paper = (accepted?.papers || []).find((candidate) => candidate.id === input?.paper?.id);
    if (!paper) failures.push({ path: "$.paper.id", reason: "paper_missing_from_claims_artifact" });
    else {
      if (JSON.stringify(paperIdentity(input.paper)) !== JSON.stringify(acceptedPaperIdentity(paper))) failures.push({ path: "$.paper", reason: "paper_identity_mismatch" });
      if (paper.provenance?.artifact_id !== provenance.source_claims_artifact) failures.push({ path: "$.provenance.source_claims_artifact", reason: "claims_artifact_paper_mismatch" });
      if (JSON.stringify(input.claims || []) !== JSON.stringify(paper.claims || [])) failures.push({ path: "$.claims", reason: "claims_packet_mismatch" });
    }
  }

  const pages = new Map((input.paper?.pages || []).map((page) => [page.page, normWhitespace(page.text)]));
  const claims = new Map((input.claims || []).map((claim) => [claim.id, claim]));
  const knownDois = new Map((input.source_work_dois || []).map((entry) => [normalizeDoi(entry.doi), entry]));
  let exactEvidence = 0;
  const seenReferences = new Set();
  if (!output || typeof output !== "object" || Array.isArray(output)) failures.push({ path: "$", reason: "output_must_be_object" });
  else {
    for (const key of Object.keys(output)) if (key !== "references") failures.push({ path: `$.${key}`, reason: "unexpected_property" });
    if (!Array.isArray(output.references)) failures.push({ path: "$.references", reason: "must_be_array" });
    else output.references.forEach((ref, refIndex) => {
      const refPath = `$.references[${refIndex}]`;
      if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
        failures.push({ path: refPath, reason: "must_be_object" });
        return;
      }
      for (const key of Object.keys(ref)) if (!["ref", "title", "doi", "year", "status", "claims", "evidence"].includes(key)) failures.push({ path: `${refPath}.${key}`, reason: "unexpected_property" });
      if (typeof ref.ref !== "string" || !ref.ref.trim()) failures.push({ path: `${refPath}.ref`, reason: "must_be_nonempty_string" });
      else if (seenReferences.has(ref.ref.trim())) failures.push({ path: `${refPath}.ref`, reason: "duplicate_reference_label" });
      else seenReferences.add(ref.ref.trim());
      for (const key of ["title", "doi"]) if (typeof ref[key] !== "string") failures.push({ path: `${refPath}.${key}`, reason: "must_be_string" });
      if (ref.year !== null && !Number.isInteger(ref.year)) failures.push({ path: `${refPath}.year`, reason: "must_be_integer_or_null" });
      if (!["used", "unused_or_unresolved"].includes(ref.status)) failures.push({ path: `${refPath}.status`, reason: "invalid_status" });
      if (!Array.isArray(ref.claims)) failures.push({ path: `${refPath}.claims`, reason: "must_be_array" });
      if (!Array.isArray(ref.evidence)) failures.push({ path: `${refPath}.evidence`, reason: "must_be_array" });
      const claimIds = Array.isArray(ref.claims) ? ref.claims : [];
      const evidenceItems = Array.isArray(ref.evidence) ? ref.evidence : [];
      if (ref.status === "used" && (!claimIds.length || !evidenceItems.length)) failures.push({ path: refPath, reason: "used_reference_requires_claims_and_evidence" });
      if (ref.status === "unused_or_unresolved" && (claimIds.length || evidenceItems.length)) failures.push({ path: refPath, reason: "unused_reference_must_not_have_claims_or_evidence" });

      const seenClaims = new Set();
      for (const [claimIndex, claimId] of claimIds.entries()) {
        if (!claims.has(claimId)) failures.push({ path: `${refPath}.claims[${claimIndex}]`, reason: "unknown_claim_id" });
        if (seenClaims.has(claimId)) failures.push({ path: `${refPath}.claims[${claimIndex}]`, reason: "duplicate_claim_id" });
        seenClaims.add(claimId);
      }
      for (const [evidenceIndex, evidence] of evidenceItems.entries()) {
        const evidencePath = `${refPath}.evidence[${evidenceIndex}]`;
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
          failures.push({ path: evidencePath, reason: "must_be_object" });
          continue;
        }
        for (const key of Object.keys(evidence)) if (!["span", "page"].includes(key)) failures.push({ path: `${evidencePath}.${key}`, reason: "unexpected_property" });
        const page = pages.get(evidence.page);
        const span = normWhitespace(evidence.span);
        if (!Number.isInteger(evidence.page) || evidence.page < 1) failures.push({ path: `${evidencePath}.page`, reason: "must_be_positive_integer" });
        if (!span) failures.push({ path: `${evidencePath}.span`, reason: "must_be_nonempty_string" });
        else if (!page?.includes(span)) failures.push({ path: `${evidencePath}.span`, reason: "span_not_found" });
        else exactEvidence += 1;
      }
      for (const [claimIndex, claimId] of claimIds.entries()) {
        const claim = claims.get(claimId);
        if (!claim) continue;
        const overlaps = evidenceItems.some((refEvidence) =>
          refEvidence && typeof refEvidence === "object" && !Array.isArray(refEvidence) &&
          (claim.evidence || []).some((claimEvidence) =>
            refEvidence.page === claimEvidence.page && spansOverlap(refEvidence.span, claimEvidence.span)
          )
        );
        if (!overlaps) failures.push({ path: `${refPath}.claims[${claimIndex}]`, reason: "claim_evidence_does_not_overlap_reference_context" });
      }

      const doi = normalizeDoi(ref.doi);
      const known = knownDois.get(doi);
      if (known && ref.title && ![known.work_title, known.version_title, ...(known.titles || [])].filter(Boolean).some((title) => titlesPlausiblyMatch(ref.title, title))) failures.push({ path: `${refPath}.doi`, reason: "known_doi_title_mismatch" });
    });
  }
  return {
    input: path.relative(rootPath(), inputPath),
    output: path.relative(rootPath(), outputPath),
    paper_id: input?.paper?.id || "",
    paper: input?.paper?.title || "",
    references: output?.references?.length || 0,
    used_references: (output?.references || []).filter((ref) => ref?.status === "used").length,
    claim_links: (output?.references || []).reduce((sum, ref) => sum + (ref?.claims?.length || 0), 0),
    exact_evidence: exactEvidence,
    input_sha256: sha256File(inputPath),
    output_sha256: sha256File(outputPath),
    source_text_path: provenance.source_text_path || "",
    source_text_sha256: provenance.source_text_sha256 || "",
    source_pdf_path: input?.paper?.pdf || "",
    source_pdf_sha256: provenance.source_pdf_sha256 || "",
    source_claims_path: provenance.source_claims_path || "",
    source_claims_sha256: provenance.source_claims_sha256 || "",
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
if (parsed.input && parsed.output) pairs = [[resolveRootPath(parsed.input), resolveRootPath(parsed.output)]];
else if (parsed.inputDir && parsed.outputDir) {
  const inputDir = resolveRootPath(parsed.inputDir);
  const outputDir = resolveRootPath(parsed.outputDir);
  pairs = fs.readdirSync(inputDir).filter((name) => name.endsWith(".input.json")).sort().map((name) => [path.join(inputDir, name), outputPathForInput(path.join(inputDir, name), outputDir)]);
} else {
  help();
  process.exit(1);
}
const results = pairs.map(([inputPath, outputPath]) =>
  fs.existsSync(outputPath)
    ? validatePair(inputPath, outputPath)
    : { input: path.relative(rootPath(), inputPath), output: path.relative(rootPath(), outputPath), paper: readJSON(inputPath)?.paper?.title || "", references: 0, used_references: 0, claim_links: 0, exact_evidence: 0, valid: false, failures: [{ reason: "missing_output" }] }
);
const report = {
  schema_version: "sciindex-validation-v0",
  bundle_id: "scientific-literature",
  recipe_sha256: recipeHash(),
  task_id: "references",
  task_sha256: taskHash(),
  generated_at: new Date().toISOString(),
  summary: { papers: results.length, valid: results.filter((result) => result.valid).length, invalid: results.filter((result) => !result.valid).length, references: results.reduce((sum, result) => sum + result.references, 0), used_references: results.reduce((sum, result) => sum + result.used_references, 0), claim_links: results.reduce((sum, result) => sum + result.claim_links, 0) },
  results,
};
writeJSON(resolveRootPath(parsed.report || "local/sciindex/references/reports/validation.json"), report);
console.log(JSON.stringify(report, null, 2));
if (report.summary.invalid) process.exitCode = 1;
