#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.join("=")];
  })
);
const indexPath = path.resolve(args["--index"] || "");
const outDir = path.resolve(args["--out-dir"] || "");
const batchCount = Number(args["--batches"] || 0);
if (!args["--index"] || !args["--out-dir"] || !Number.isInteger(batchCount) || batchCount < 1) {
  console.error("Usage: node tools/sciindex/make-batches.mjs --index=INDEX.json --out-dir=DIR --batches=N");
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const batches = Array.from({ length: batchCount }, (_, index) => ({
  batch: index + 1,
  bytes: 0,
  inputs: [],
}));
const inputs = (index.inputs || [])
  .map((input) => ({ input, bytes: fs.statSync(path.resolve(input)).size }))
  .sort((left, right) => right.bytes - left.bytes || left.input.localeCompare(right.input));

for (const item of inputs) {
  const batch = [...batches].sort(
    (left, right) => left.bytes - right.bytes || left.batch - right.batch
  )[0];
  batch.inputs.push(item.input);
  batch.bytes += item.bytes;
}

fs.mkdirSync(outDir, { recursive: true });
for (const batch of batches) {
  batch.inputs.sort();
  const output = path.join(outDir, `batch-${batch.batch}.json`);
  fs.writeFileSync(output, `${JSON.stringify(batch, null, 2)}\n`);
  console.log(`${output}: ${batch.inputs.length} inputs, ${batch.bytes} bytes`);
}
