import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bucketForObjectId, createObjectViewProjector } from "./lib/object-view.mjs";

const BUCKET_COUNT = 64;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(rootDir, "db", "resource-index.json");
const outputDir = path.join(rootDir, "object-data");
const resourceIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const projectObject = createObjectViewProjector(resourceIndex);
const buckets = Array.from({ length: BUCKET_COUNT }, () => ({}));

for (const object of [...resourceIndex.objects].sort((left, right) => left.id.localeCompare(right.id))) {
  buckets[bucketForObjectId(object.id, BUCKET_COUNT)][object.id] = projectObject(object.id);
}

fs.mkdirSync(outputDir, { recursive: true });
for (let index = 0; index < BUCKET_COUNT; index += 1) {
  const filename = `${index.toString(16).padStart(2, "0")}.json`;
  fs.writeFileSync(path.join(outputDir, filename), `${JSON.stringify(buckets[index])}\n`);
}

fs.writeFileSync(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify({ schema_version: "object-pages-v0", bucket_count: BUCKET_COUNT, objects: resourceIndex.objects.length })}\n`
);

console.log(`Generated ${resourceIndex.objects.length} object views in ${BUCKET_COUNT} buckets.`);
