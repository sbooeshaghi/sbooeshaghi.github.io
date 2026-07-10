import fs from "node:fs";
import path from "node:path";
import {
  recipeHash,
  resolveRootPath,
  rootPath,
  sha256,
  sha256File,
  stableSlug,
  writeJSON,
} from "./common.mjs";
import { extractPages } from "./pdf-text.mjs";

export function paperFromPdf(pdf) {
  const pdfPath = resolveRootPath(pdf);
  const title = path.basename(pdfPath, ".pdf").replace(/-/g, " ");

  return {
    id: `pdf--${stableSlug(path.basename(pdfPath, ".pdf"))}`,
    title,
    year: null,
    doi: "",
    source_url: "",
    pdf: path.relative(rootPath(), pdfPath),
    cited_source_works_from_scholar: [],
  };
}

function textForPages(pages) {
  return `${pages
    .map(({ page, text }) => `=== Page ${page} ===\n${text}`)
    .join("\n\n")}\n`;
}

export function packagePaper(paper, { sourceDir }) {
  const pdfPath = resolveRootPath(paper.pdf);
  const pages = extractPages(pdfPath);
  const text = textForPages(pages);
  const textPath = path.join(resolveRootPath(sourceDir), `${stableSlug(paper.id)}.txt`);
  fs.mkdirSync(path.dirname(textPath), { recursive: true });
  fs.writeFileSync(textPath, text);

  return {
    ...paper,
    pdf_sha256: sha256File(pdfPath),
    text_path: path.relative(rootPath(), textPath),
    text_sha256: sha256(text),
    page_count: pages.length,
    text_char_count: pages.reduce((sum, page) => sum + page.text.length, 0),
    pages,
  };
}

export function buildInputPacket(paper, options = {}) {
  const packaged = packagePaper(paper, options);
  return {
    schema_version: "sciindex-source-packet-v0",
    provenance: {
      bundle_id: "scientific-literature",
      recipe_sha256: recipeHash(),
      source_pdf_sha256: packaged.pdf_sha256,
      source_text_sha256: packaged.text_sha256,
      source_text_path: packaged.text_path,
    },
    source_work_dois: options.catalog || [],
    paper: packaged,
  };
}

export function inputFileNameForPaper(paper) {
  return `${stableSlug(paper.id || paper.title)}.input.json`;
}

export function writeInputPackets(
  papers,
  {
    outDir = "local/sciindex/source/inputs",
    sourceDir = "local/sciindex/source/text",
    catalog = [],
    replaceIndex = false,
  } = {}
) {
  const packets = papers.map((paper) => buildInputPacket(paper, { sourceDir, catalog }));
  const written = [];

  if (outDir) {
    const outputDir = resolveRootPath(outDir);

    for (const packet of packets) {
      const filePath = path.join(outputDir, inputFileNameForPaper(packet.paper));
      writeJSON(filePath, packet);
      written.push(filePath);
    }

    const indexPath = path.join(outputDir, "index.json");
    const existingInputs = replaceIndex || !fs.existsSync(indexPath)
      ? []
      : JSON.parse(fs.readFileSync(indexPath, "utf8")).inputs || [];
    writeJSON(indexPath, {
      schema_version: "sciindex-source-index-v0",
      bundle_id: "scientific-literature",
      recipe_sha256: recipeHash(),
      inputs: [...new Set([
        ...existingInputs,
        ...written.map((filePath) => path.relative(rootPath(), filePath)),
      ])].sort(),
    });
  }

  return { packets, written };
}
