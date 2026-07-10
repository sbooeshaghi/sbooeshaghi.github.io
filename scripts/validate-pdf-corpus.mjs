import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const args = new Set(process.argv.slice(2));
const scopeArg = [...args].find((arg) => arg.startsWith("--scope="));
const scope = scopeArg ? scopeArg.split("=")[1] : "cited-by";

if (!["cited-by", "works"].includes(scope)) {
  console.error("Usage: node scripts/validate-pdf-corpus.mjs [--scope=cited-by|works]");
  process.exit(1);
}

const corpusDir =
  scope === "cited-by"
    ? path.join(rootDir, "local", "papers", "cited-by")
    : path.join(rootDir, "local", "papers", "works");
const outputPath = path.join(
  rootDir,
  "local",
  "citation-context",
  `${scope}-pdf-validation.local.json`
);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) return [entryPath];
    return [];
  });
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parsePdfInfo(stdout) {
  const out = {};
  for (const line of stdout.split("\n")) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) out[match[1].trim().toLowerCase().replaceAll(" ", "_")] = match[2].trim();
  }
  return out;
}

const files = walk(corpusDir).sort();
const results = [];

for (const [index, filePath] of files.entries()) {
  const relativePath = path.relative(rootDir, filePath);
  process.stderr.write(`[${index + 1}/${files.length}] ${relativePath}\n`);

  try {
    const info = parsePdfInfo(execFileSync("pdfinfo", [filePath], { encoding: "utf8" }));
    const stat = fs.statSync(filePath);
    results.push({
      path: relativePath,
      ok: true,
      bytes: stat.size,
      sha256: sha256(filePath),
      pages: Number(info.pages || 0),
      title: info.title || "",
      pdf_version: info.pdf_version || "",
    });
  } catch (error) {
    results.push({
      path: relativePath,
      ok: false,
      error: error.message,
    });
  }
}

const byHash = new Map();
for (const result of results.filter((entry) => entry.ok)) {
  if (!byHash.has(result.sha256)) byHash.set(result.sha256, []);
  byHash.get(result.sha256).push(result.path);
}

const duplicate_groups = [...byHash.entries()]
  .filter(([, paths]) => paths.length > 1)
  .map(([hash, paths]) => ({ sha256: hash, paths }));

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  scope,
  corpus_dir: path.relative(rootDir, corpusDir),
  total: results.length,
  valid: results.filter((entry) => entry.ok).length,
  invalid: results.filter((entry) => !entry.ok),
  duplicate_groups,
  results,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      report: path.relative(rootDir, outputPath),
      total: report.total,
      valid: report.valid,
      invalid: report.invalid.length,
      duplicate_groups: report.duplicate_groups.length,
    },
    null,
    2
  )
);
