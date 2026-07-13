#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg.startsWith("--authors=")) args.authors = arg.slice("--authors=".length);
    else if (arg.startsWith("--index=")) args.index = arg.slice("--index=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeOrcid(value) {
  const match = String(value || "").match(/(\d{4}-\d{4}-\d{4}-[\dX]{4})/i);
  if (!match) return "";
  const orcid = match[1].toUpperCase();
  const digits = orcid.replaceAll("-", "");
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const remainder = (12 - (total % 11)) % 11;
  const checksum = remainder === 10 ? "X" : String(remainder);
  return checksum === digits[15] ? orcid : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function mergePerson(existing, incoming) {
  if (!existing) return structuredClone(incoming);
  const label = existing.label || incoming.label;
  return {
    ...existing,
    id: incoming.id,
    label,
    description: label,
    properties: {
      ...existing.properties,
      ...incoming.properties,
      aliases: unique([
        existing.label,
        incoming.label,
        ...(existing.properties?.aliases || []),
        ...(incoming.properties?.aliases || []),
      ]),
      identifiers: unique([
        ...(existing.properties?.identifiers || []),
        ...(incoming.properties?.identifiers || []),
      ].map((identifier) => JSON.stringify(identifier))).map((identifier) => JSON.parse(identifier)),
      provenance: unique([
        ...(existing.properties?.provenance || []),
        ...(incoming.properties?.provenance || []),
      ]),
    },
  };
}

function authorOrcids(catalog) {
  const byName = new Map();
  for (const work of Object.values(catalog.works || {})) {
    for (const version of work.versions || []) {
      for (const author of version.authors || []) {
        const name = normalizeName(author.name);
        const orcid = normalizeOrcid(author.orcid);
        if (!name || !orcid) continue;
        const existing = byName.get(name);
        if (existing && existing !== orcid) {
          throw new Error(`Conflicting ORCIDs for ${author.name}: ${existing}, ${orcid}`);
        }
        byName.set(name, orcid);
      }
    }
  }
  return byName;
}

function mappedOrcid(person, byName) {
  const matches = unique([
    person.label,
    ...(person.properties?.aliases || []),
  ].map((name) => byName.get(normalizeName(name))));
  if (matches.length > 1) throw new Error(`Person ${person.id} maps to multiple ORCIDs`);
  return matches[0] || "";
}

function migrate(index, byName) {
  const replacements = new Map();
  for (const object of index.objects || []) {
    if (object.kind !== "person") continue;
    const orcid = mappedOrcid(object, byName);
    if (orcid) replacements.set(object.id, `person:orcid:${orcid}`);
  }

  const objects = new Map();
  for (const original of index.objects || []) {
    if (original.kind !== "person") {
      if (objects.has(original.id)) throw new Error(`Duplicate object id: ${original.id}`);
      objects.set(original.id, original);
      continue;
    }

    const id = replacements.get(original.id) || original.id;
    const orcid = id.startsWith("person:orcid:") ? id.slice("person:orcid:".length) : "";
    const identifiers = (original.properties?.identifiers || [])
      .filter((identifier) => identifier.namespace !== "local" && identifier.namespace !== "orcid");
    if (orcid) identifiers.push({ namespace: "orcid", value: `https://orcid.org/${orcid}` });
    identifiers.push({ namespace: "local", value: id });
    const person = {
      ...original,
      id,
      properties: {
        ...original.properties,
        identifiers,
      },
    };
    objects.set(id, mergePerson(objects.get(id), person));
  }

  const connections = new Map();
  for (const original of index.connections || []) {
    const source = replacements.get(original.source) || original.source;
    const target = replacements.get(original.target) || original.target;
    let id = original.id;
    if (source !== original.source) id = id.replace(original.source, source);
    if (target !== original.target) id = id.replace(original.target, target);
    const connection = { ...original, id, source, target };
    const existing = connections.get(id);
    if (existing && (
      existing.source !== source ||
      existing.target !== target ||
      existing.statement !== connection.statement
    )) throw new Error(`Conflicting connection after ORCID merge: ${id}`);
    connections.set(id, existing || connection);
  }

  const migrated = {
    ...index,
    objects: [...objects.values()],
    connections: [...connections.values()],
  };
  validate(migrated, byName);
  return { migrated, replacements };
}

function validate(index, byName) {
  const objectIds = new Set();
  const peopleByName = new Map();
  for (const object of index.objects || []) {
    if (objectIds.has(object.id)) throw new Error(`Duplicate object id: ${object.id}`);
    objectIds.add(object.id);
    if (object.kind !== "person") continue;
    for (const alias of unique([object.label, ...(object.properties?.aliases || [])])) {
      peopleByName.set(normalizeName(alias), object);
    }
    if (object.id.startsWith("person:orcid:")) {
      const orcid = object.id.slice("person:orcid:".length);
      const expected = `https://orcid.org/${orcid}`;
      if (!(object.properties?.identifiers || []).some(
        (identifier) => identifier.namespace === "orcid" && identifier.value === expected
      )) throw new Error(`ORCID namespace identifier missing for ${object.id}`);
    }
  }
  for (const [name, orcid] of byName) {
    const person = peopleByName.get(name);
    if (!person) throw new Error(`Author is absent from graph: ${name}`);
    if (person.id !== `person:orcid:${orcid}`) {
      throw new Error(`Author ${name} is not grounded to ORCID ${orcid}`);
    }
  }
  for (const connection of index.connections || []) {
    if (!objectIds.has(connection.source)) throw new Error(`Dangling connection source: ${connection.id}`);
    if (!objectIds.has(connection.target)) throw new Error(`Dangling connection target: ${connection.id}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const authorsPath = path.resolve(rootDir, args.authors || "db/publication-authors.json");
const indexPath = path.resolve(rootDir, args.index || "db/resource-index.json");
const outputPath = path.resolve(rootDir, args.out || args.index || "db/resource-index.json");
const catalog = JSON.parse(fs.readFileSync(authorsPath, "utf8"));
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const byName = authorOrcids(catalog);
const beforePeople = index.objects.filter((object) => object.kind === "person").length;
const beforeOrcids = index.objects.filter((object) => object.kind === "person" && object.id.startsWith("person:orcid:")).length;
const { migrated, replacements } = migrate(index, byName);
const afterPeople = migrated.objects.filter((object) => object.kind === "person").length;
const afterOrcids = migrated.objects.filter((object) => object.kind === "person" && object.id.startsWith("person:orcid:")).length;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(migrated, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(rootDir, outputPath),
  author_names_with_orcid: byName.size,
  person_ids_rewritten: [...replacements].filter(([from, to]) => from !== to).length,
  people_before: beforePeople,
  people_after: afterPeople,
  orcid_people_before: beforeOrcids,
  orcid_people_after: afterOrcids,
}, null, 2));
