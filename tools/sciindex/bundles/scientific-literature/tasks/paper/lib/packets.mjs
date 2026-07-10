import fs from "node:fs";
import path from "node:path";
import {
  modulePath,
  recipeHash,
  readText,
  resolveRootPath,
  rootPath,
  sha256,
  sha256File,
  stableSlug,
  taskHash,
  writeJSON,
} from "./common.mjs";
import { extractPages } from "./pdf-text.mjs";

export function citationContextPrompt() {
  return readText(modulePath("prompt.md")).trim();
}

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
    schema_version: "sciindex-task-input-v0",
    provenance: {
      bundle_id: "scientific-literature",
      recipe_sha256: recipeHash(),
      task_id: "paper",
      task_sha256: taskHash(),
      source_pdf_sha256: packaged.pdf_sha256,
      source_text_sha256: packaged.text_sha256,
      source_text_path: packaged.text_path,
    },
    llm_prompt: citationContextPrompt(),
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
    outDir = "local/sciindex/paper/inputs",
    sourceDir = "local/sciindex/paper/sources",
    catalog = [],
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

    const inputs = fs
      .readdirSync(outputDir)
      .filter((name) => name.endsWith(".input.json"))
      .sort()
      .map((name) => path.relative(rootPath(), path.join(outputDir, name)));
    writeJSON(path.join(outputDir, "index.json"), {
      schema_version: "sciindex-task-input-index-v0",
      bundle_id: "scientific-literature",
      recipe_sha256: recipeHash(),
      task_id: "paper",
      task_sha256: taskHash(),
      inputs,
    });
  }

  return { packets, written };
}
