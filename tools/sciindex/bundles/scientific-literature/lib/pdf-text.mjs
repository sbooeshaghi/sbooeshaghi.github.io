import { execFileSync } from "node:child_process";

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    ...options,
  });
}

export function pdfPageCount(pdfPath) {
  const info = run("pdfinfo", [pdfPath], { maxBuffer: 2 * 1024 * 1024 });
  const match = info.match(/^Pages:\s+(\d+)/m);
  return match ? Number(match[1]) : 0;
}

export function cleanExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\u00ad/g, "")
    .replace(/[ﬁ]/g, "fi")
    .replace(/[ﬂ]/g, "fl")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function extractPages(pdfPath) {
  const pageCount = pdfPageCount(pdfPath);
  const pages = [];

  for (let page = 1; page <= pageCount; page += 1) {
    const rawText = run("pdftotext", [
      "-raw",
      "-enc",
      "UTF-8",
      "-f",
      String(page),
      "-l",
      String(page),
      pdfPath,
      "-",
    ]);

    pages.push({
      page,
      text: cleanExtractedText(rawText),
    });
  }

  return pages;
}
