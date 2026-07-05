import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const steps = [
  ["build-cited-by.mjs", "Build minimal cited_by data"],
  ["build-work-pages.mjs", "Regenerate work pages"],
  ["verify-cited-by.mjs", "Verify citation data and pages"],
];

for (const [script, label] of steps) {
  console.log(`\n${label}`);
  execFileSync(process.execPath, [path.join(scriptDir, script)], {
    cwd: rootDir,
    stdio: "inherit",
  });
}
