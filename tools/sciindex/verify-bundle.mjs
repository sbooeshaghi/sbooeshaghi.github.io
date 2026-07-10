#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const bundleDir = path.resolve(
  process.argv[2] || "tools/sciindex/bundles/scientific-literature"
);
const errors = [];

function read(relativePath) {
  const filePath = path.join(bundleDir, relativePath);
  if (!fs.existsSync(filePath)) {
    errors.push(`missing ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function requireFields(value, fields, context) {
  for (const field of fields) {
    if (value?.[field] === undefined || value?.[field] === "") {
      errors.push(`${context}: missing ${field}`);
    }
  }
}

function verifyFiles(base, manifest, fields) {
  for (const field of fields) {
    const relativePath = manifest?.[field];
    if (relativePath && !fs.existsSync(path.join(base, relativePath))) {
      errors.push(`${path.relative(bundleDir, base)}: missing ${field} file ${relativePath}`);
    }
  }
}

const bundle = read("bundle.json");
if (bundle) {
  requireFields(bundle, ["schema_version", "id", "version", "recipe", "tasks"], "bundle");
  if (!Array.isArray(bundle.tasks) || !bundle.tasks.length) {
    errors.push("bundle: tasks must be a nonempty array");
  }
}

const recipe = bundle?.recipe ? read(bundle.recipe) : null;
if (recipe) {
  requireFields(
    recipe,
    [
      "schema_version",
      "id",
      "version",
      "identifier_namespaces",
      "object_kinds",
      "connection_patterns",
      "source_kinds",
      "verifiers",
    ],
    "recipe"
  );
  if (recipe.id !== bundle.id) errors.push("recipe: id must match bundle id");

  const verifiers = new Set(Object.keys(recipe.verifiers || {}));
  const namespaces = new Set(Object.keys(recipe.identifier_namespaces || {}));
  const objectKinds = new Set(Object.keys(recipe.object_kinds || {}));
  const checkVerifiers = (names, context) => {
    for (const name of names || []) {
      if (!verifiers.has(name)) errors.push(`${context}: unknown verifier ${name}`);
    }
  };

  for (const [namespace, checks] of Object.entries(recipe.identifier_namespaces || {})) {
    checkVerifiers(checks, `identifier namespace ${namespace}`);
  }
  for (const [kind, definition] of Object.entries(recipe.object_kinds || {})) {
    for (const namespace of definition.identifiers || []) {
      if (!namespaces.has(namespace)) {
        errors.push(`object kind ${kind}: unknown identifier namespace ${namespace}`);
      }
    }
    checkVerifiers(definition.verifiers, `object kind ${kind}`);
  }
  for (const [kind, checks] of Object.entries(recipe.source_kinds || {})) {
    checkVerifiers(checks, `source kind ${kind}`);
  }
  for (const [index, pattern] of (recipe.connection_patterns || []).entries()) {
    if (!objectKinds.has(pattern.source)) {
      errors.push(`connection pattern ${index}: unknown source kind ${pattern.source}`);
    }
    if (!objectKinds.has(pattern.target)) {
      errors.push(`connection pattern ${index}: unknown target kind ${pattern.target}`);
    }
    checkVerifiers(pattern.verifiers, `connection pattern ${index}`);
  }
}

for (const taskPath of bundle?.tasks || []) {
  const task = read(taskPath);
  if (!task) continue;
  requireFields(
    task,
    ["schema_version", "id", "version", "prompt", "output_schema", "prepare", "validate"],
    taskPath
  );
  verifyFiles(path.dirname(path.join(bundleDir, taskPath)), task, [
    "prompt",
    "output_schema",
    "prepare",
    "validate",
  ]);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `Verified bundle ${bundle.id}@${bundle.version}: ${Object.keys(recipe.object_kinds).length} object kinds, ${recipe.connection_patterns.length} connection patterns, ${bundle.tasks.length} task.`
);
