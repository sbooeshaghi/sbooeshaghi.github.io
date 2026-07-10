#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.resolve(rootDir, process.argv[2] || "db/resource-index.json");
const recipePath = path.resolve(
  rootDir,
  process.argv[3] || "tools/sciindex/bundles/scientific-literature/recipe.json"
);
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));
const errors = [];

function fail(message) {
  errors.push(message);
}

function requireString(record, field, context) {
  if (typeof record?.[field] !== "string" || !record[field].trim()) {
    fail(`${context}: missing ${field}`);
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function recipeSha256() {
  return sha256(recipePath);
}

function identifierFormatValid(namespace, value) {
  const text = String(value || "").trim();
  if (!text) return false;
  switch (namespace) {
    case "doi":
      return /^10\.\d{4,9}\/.+/i.test(text);
    case "pmid":
      return /^\d+$/.test(text);
    case "pmcid":
      return /^PMC\d+$/i.test(text);
    case "arxiv":
      return /^(?:arxiv:)?(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?$/i.test(text);
    case "google_scholar_cluster":
      return /^\d+$/.test(text);
    case "orcid":
      return /^(?:https?:\/\/orcid\.org\/)?\d{4}-\d{4}-\d{4}-[\dX]{4}$/i.test(text);
    case "url":
    case "repository":
      try {
        return ["http:", "https:"].includes(new URL(text).protocol);
      } catch {
        return false;
      }
    case "package_registry":
    case "local":
      return true;
    default:
      return false;
  }
}

function indexById(items, label) {
  const records = new Map();
  for (const [position, item] of (items || []).entries()) {
    const context = `${label}[${position}]`;
    requireString(item, "id", context);
    if (!item?.id) continue;
    if (records.has(item.id)) fail(`${context}: duplicate id ${item.id}`);
    records.set(item.id, item);
  }
  return records;
}

if (!Array.isArray(index.objects)) fail("index: objects must be an array");
if (!Array.isArray(index.connections)) fail("index: connections must be an array");
if (!Array.isArray(index.sources)) fail("index: sources must be an array");
if (index.recipe?.id !== recipe.id || index.recipe?.version !== recipe.version) {
  fail("index: recipe identity does not match");
}
if (index.recipe?.sha256 !== recipeSha256()) {
  fail("index: recipe hash does not match");
}

const objects = indexById(index.objects, "objects");
const connections = indexById(index.connections, "connections");
const sources = indexById(index.sources, "sources");
const allowedObjectKinds = new Set(Object.keys(recipe.object_kinds || {}));
const allowedSourceKinds = new Set(Object.keys(recipe.source_kinds || {}));
const allowedPatterns = new Set(
  (recipe.connection_patterns || []).map(({ source, target }) => `${source}->${target}`)
);

for (const [id, object] of objects) {
  requireString(object, "kind", id);
  requireString(object, "label", id);
  if (typeof object.description !== "string") fail(`${id}: description must be a string`);
  if (!allowedObjectKinds.has(object.kind)) fail(`${id}: unknown object kind ${object.kind}`);
  if (!object.properties || Array.isArray(object.properties) || typeof object.properties !== "object") {
    fail(`${id}: properties must be an object`);
  }
  const identifiers = object.properties?.identifiers;
  if (!Array.isArray(identifiers) || !identifiers.length) {
    fail(`${id}: at least one identifier is required`);
  } else {
    const allowedNamespaces = new Set(recipe.object_kinds?.[object.kind]?.identifiers || []);
    identifiers.forEach((identifier, position) => {
      const context = `${id}.identifiers[${position}]`;
      requireString(identifier, "namespace", context);
      requireString(identifier, "value", context);
      if (identifier.namespace && !allowedNamespaces.has(identifier.namespace)) {
        fail(`${context}: namespace ${identifier.namespace} is not allowed for ${object.kind}`);
      } else if (!identifierFormatValid(identifier.namespace, identifier.value)) {
        fail(`${context}: invalid ${identifier.namespace} identifier ${identifier.value}`);
      }
    });
  }
  if (object.kind === "claim" && !object.properties?.evidence?.length) {
    fail(`${id}: claim must have grounded evidence`);
  }
}

const sourcePages = new Map();
for (const [id, source] of sources) {
  requireString(source, "kind", id);
  requireString(source, "label", id);
  requireString(source, "locator", id);
  if (!allowedSourceKinds.has(source.kind)) fail(`${id}: unknown source kind ${source.kind}`);
  if (source.kind === "local_text" || source.kind === "local_pdf") {
    const filePath = path.resolve(rootDir, source.locator || "");
    if (!fs.existsSync(filePath)) {
      fail(`${id}: local source does not exist`);
      continue;
    }
    const expectedHash = source.properties?.sha256;
    if (!expectedHash) fail(`${id}: local source hash is required`);
    else if (sha256(filePath) !== expectedHash) fail(`${id}: local source hash does not match`);

    if (source.kind === "local_text") {
      const text = fs.readFileSync(filePath, "utf8");
      const pages = new Map();
      const matches = [...text.matchAll(/=== Page (\d+) ===\n([\s\S]*?)(?=\n\n=== Page \d+ ===\n|$)/g)];
      if (matches.length) {
        matches.forEach((match) => pages.set(Number(match[1]), normWhitespace(match[2])));
      } else {
        pages.set(null, normWhitespace(text));
      }
      sourcePages.set(id, pages);
    }
  }
}

function verifyEvidenceArray(evidence, context) {
  if (!Array.isArray(evidence)) {
    fail(`${context}: evidence must be an array`);
    return;
  }
  for (const [position, item] of evidence.entries()) {
    const itemContext = `${context}.evidence[${position}]`;
    requireString(item, "source", itemContext);
    requireString(item, "span", itemContext);
    if (item.source && !sources.has(item.source)) {
      fail(`${itemContext}: missing source ${item.source}`);
    }
    if (item.page !== null && !Number.isInteger(item.page)) {
      fail(`${itemContext}: page must be an integer or null`);
    }
    const pages = sourcePages.get(item.source);
    if (!pages) {
      fail(`${itemContext}: evidence must point to retained local text`);
    } else {
      const pageText = pages.get(item.page) || pages.get(null);
      if (!pageText) fail(`${itemContext}: source page is missing`);
      else if (!pageText.includes(normWhitespace(item.span))) {
        fail(`${itemContext}: span does not exact-match source text`);
      }
    }
  }
}

for (const [id, object] of objects) {
  if (object.kind === "claim") {
    verifyEvidenceArray(object.properties?.evidence, id);
  }
}

for (const [id, connection] of connections) {
  requireString(connection, "source", id);
  requireString(connection, "target", id);
  requireString(connection, "statement", id);
  const sourceObject = objects.get(connection.source);
  const targetObject = objects.get(connection.target);
  if (!sourceObject) fail(`${id}: missing source object ${connection.source}`);
  if (!targetObject) fail(`${id}: missing target object ${connection.target}`);
  if (sourceObject && targetObject) {
    const pattern = `${sourceObject.kind}->${targetObject.kind}`;
    if (!allowedPatterns.has(pattern)) fail(`${id}: connection pattern ${pattern} is not in the recipe`);
  }
  verifyEvidenceArray(connection.evidence, id);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `Verified resource index: ${objects.size} objects, ${connections.size} connections, ${sources.size} sources against ${recipe.id}.`
);
