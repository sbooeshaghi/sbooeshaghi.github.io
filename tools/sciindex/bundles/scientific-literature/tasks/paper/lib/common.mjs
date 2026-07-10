import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const libDir = path.dirname(fileURLToPath(import.meta.url));
export const moduleDir = path.resolve(libDir, "..");
export const bundleDir = path.resolve(moduleDir, "..", "..");
export const rootDir = path.resolve(process.env.SCIINDEX_ROOT || process.cwd());

export function rootPath(...parts) {
  return path.join(rootDir, ...parts);
}

export function modulePath(...parts) {
  return path.join(moduleDir, ...parts);
}

export function bundlePath(...parts) {
  return path.join(bundleDir, ...parts);
}

export function resolveRootPath(value) {
  return path.isAbsolute(value) ? value : rootPath(value);
}

export function readJSON(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function recipeHash() {
  return sha256File(bundlePath("recipe.json"));
}

export function taskHash() {
  return sha256(
    [
      "task.json",
      "prompt.md",
      "schema.json",
      "prepare.mjs",
      "validate.mjs",
      "lib/common.mjs",
      "lib/packets.mjs",
      "lib/pdf-text.mjs",
    ]
      .map((name) => fs.readFileSync(modulePath(name)))
      .reduce((all, value) => Buffer.concat([all, value]), Buffer.alloc(0))
  );
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleFingerprint(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function titleTokens(value) {
  return new Set(
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length > 2)
      .map((token) => (token.length > 4 ? token.replace(/s$/, "") : token)) || []
  );
}

export function titlesPlausiblyMatch(left, right) {
  const leftFingerprint = titleFingerprint(left);
  const rightFingerprint = titleFingerprint(right);
  if (!leftFingerprint || !rightFingerprint) return false;
  if (
    Math.min(leftFingerprint.length, rightFingerprint.length) >= 12 &&
    (leftFingerprint.includes(rightFingerprint) || rightFingerprint.includes(leftFingerprint))
  ) {
    return true;
  }

  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.8;
}

export function stableSlug(value, maxLength = 110) {
  const slug = slugify(value) || "untitled";
  if (slug.length <= maxLength) return slug;
  const suffix = sha256(String(value || "")).slice(0, 10);
  return `${slug
    .slice(0, maxLength - suffix.length - 1)
    .replace(/-+$/g, "")}-${suffix}`;
}

export function normalizeDoi(value) {
  const raw = String(value || "").trim();
  let doi = "";
  const doiUrl = raw.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  const preprintUrl = raw.match(
    /^https?:\/\/(?:www\.)?(?:bio|med)rxiv\.org\/content\/(10\..+)$/i
  );
  const prefixed = raw.match(/^doi:\s*(10\..+)$/i);

  if (/^10\./i.test(raw)) doi = raw;
  else if (doiUrl) doi = doiUrl[1];
  else if (preprintUrl) doi = preprintUrl[1];
  else if (prefixed) doi = prefixed[1];
  else return "";

  doi = doi
    .replace(/[),.;:\]]+$/g, "")
    .replace(/\?versioned=true$/i, "")
    .replace(/\.full(?:\.pdf)?$/i, "")
    .replace(/\.abstract$/i, "");

  const match = doi.match(/^10\.\d{4,9}\/[a-z0-9._;()/:+-]+/i);
  if (!match) return "";
  doi = match[0].replace(/[),.;:\]]+$/g, "");
  doi = doi.replace(/^(10\.1101\/\d{4}\.\d{2}\.\d{2}\.\d+)(?:v\d+)$/i, "$1");
  return doi.toLowerCase();
}

export function normWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function parseArgs(argv, handlers) {
  const parsed = {};

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      handlers.help();
      process.exit(0);
    }

    const equalIndex = arg.indexOf("=");
    const key = equalIndex >= 0 ? arg.slice(0, equalIndex) : arg;
    const value = equalIndex >= 0 ? arg.slice(equalIndex + 1) : true;
    const handler = handlers[key];

    if (!handler) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    handler(parsed, value);
  }

  return parsed;
}
