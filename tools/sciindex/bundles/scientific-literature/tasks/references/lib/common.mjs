import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDoi,
  normWhitespace,
  parseArgs,
  readJSON,
  readText,
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256,
  sha256File,
  stableSlug,
  titlesPlausiblyMatch,
  writeJSON,
} from "../../../lib/common.mjs";

export {
  normalizeDoi,
  normWhitespace,
  parseArgs,
  readJSON,
  readText,
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256,
  sha256File,
  stableSlug,
  titlesPlausiblyMatch,
  writeJSON,
};
export const moduleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function modulePath(...parts) {
  return path.join(moduleDir, ...parts);
}
export function taskHash() {
  const files = [
    "task.json",
    "prompt.md",
    "schema.json",
    "prepare.mjs",
    "validate.mjs",
    "lib/common.mjs",
    path.resolve(moduleDir, "../../lib/common.mjs"),
    path.resolve(moduleDir, "../claims/lib/common.mjs"),
    path.resolve(moduleDir, "../../../../provenance.mjs"),
  ];
  return sha256(
    files
      .map((name) => fs.readFileSync(path.isAbsolute(name) ? name : modulePath(name)))
      .reduce((all, value) => Buffer.concat([all, value]), Buffer.alloc(0))
  );
}
