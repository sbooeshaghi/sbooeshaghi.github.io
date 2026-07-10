import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const reportPath = path.join(rootDir, "local", "citation-context", "pdf-download-report.json");

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const scopeArg = [...args].find((arg) => arg.startsWith("--scope="));
const limitArg = [...args].find((arg) => arg.startsWith("--limit="));
const concurrencyArg = [...args].find((arg) => arg.startsWith("--concurrency="));
const timeoutArg = [...args].find((arg) => arg.startsWith("--timeout-ms="));
const scope = scopeArg ? scopeArg.split("=")[1] : "works";
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const concurrency = Math.max(1, concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 3);
const timeoutMs = Math.max(1000, timeoutArg ? Number(timeoutArg.split("=")[1]) : 20000);

if (!["works", "cited-by", "all"].includes(scope)) {
  console.error("Usage: node scripts/download-pdf-targets.mjs [--scope=works|cited-by|all] [--limit=N] [--concurrency=N] [--timeout-ms=N]");
  process.exit(1);
}

const userAgent = "Mozilla/5.0 (compatible; local scholarly PDF provenance downloader; +https://sbooeshaghi.github.io)";

function targetList() {
  const checklistPath = path.join(
    rootDir,
    "local",
    "citation-context",
    "cited-by-pdf-checklist.local.json"
  );

  if (scope === "cited-by" && fs.existsSync(checklistPath)) {
    const checklist = JSON.parse(fs.readFileSync(checklistPath, "utf8"));
    return checklist.items
      .filter((item) => item.pdf_status === "missing")
      .filter((item) => !fs.existsSync(path.join(rootDir, item.pdf_path)))
      .slice(0, limit);
  }

  const stdout = execFileSync(
    process.execPath,
    [path.join(rootDir, "scripts", "list-pdf-targets.mjs"), `--scope=${scope}`, "--json", "--missing"],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  );
  return JSON.parse(stdout).targets.slice(0, limit);
}

function doiFromURL(value) {
  const match = String(value || "").match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function doiFromPreprintURL(value) {
  const match = String(value || "").match(/\/content\/(?:[^/]+\/early\/\d+\/\d+\/\d+\/)?(10\.(?:1101|64898)\/[^/?#]+?)(?:v\d+)?(?:\.(?:abstract|full\.pdf|full))?(?:[?#].*)?$/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function absoluteURL(href, baseURL) {
  try {
    return new URL(href, baseURL).toString();
  } catch {
    return "";
  }
}

function plosJournalFromDOI(doi) {
  const match = doi.match(/^10\.1371\/journal\.([a-z]+)\./i);
  if (!match) return "";
  return {
    pcbi: "ploscompbiol",
    pone: "plosone",
    pgen: "plosgenetics",
    ppat: "plospathogens",
    pbio: "plosbiology",
    pmed: "plosmedicine",
  }[match[1].toLowerCase()] || "";
}

function skipReason(target) {
  const sourceURL = String(target.source_url || "");
  if (!sourceURL) return "missing source URL";
  if (/scholar\.google/i.test(sourceURL) || target.source_kind === "google_scholar") {
    return "google scholar pages are intentionally skipped";
  }
  if (/search\.proquest/i.test(sourceURL) || target.source_kind === "proquest") {
    return "proquest pages are intentionally skipped";
  }
  return "";
}

function candidatesFor(target) {
  const sourceURL = target.source_url || "";
  const doi = doiFromURL(sourceURL) || doiFromPreprintURL(sourceURL);
  const candidates = [];

  if (skipReason(target)) return candidates;

  if (/\.pdf(?:[?#].*)?$/i.test(sourceURL)) {
    candidates.push(sourceURL);
  }

  if (/^https?:\/\/(?:www\.)?(bio|med)rxiv\.org\/content\/.+/i.test(sourceURL)) {
    const cleanURL = sourceURL.replace(/[?#].*$/, "");
    if (/\.abstract$/i.test(cleanURL)) {
      candidates.push(cleanURL.replace(/\.abstract$/i, ".full.pdf"));
    } else if (!/\.full\.pdf$/i.test(cleanURL)) {
      candidates.push(`${cleanURL}.full.pdf`);
    }
  }

  if (doi.startsWith("10.1101/") || doi.startsWith("10.64898/")) {
    candidates.push(`https://www.biorxiv.org/content/${doi}.full.pdf`);
    candidates.push(`https://www.medrxiv.org/content/${doi}.full.pdf`);
  }

  if (doi.startsWith("10.1038/")) {
    candidates.push(`https://www.nature.com/articles/${doi.split("/").pop()}.pdf`);
  }

  if (doi.startsWith("10.1371/")) {
    const journal = plosJournalFromDOI(doi);
    if (journal) {
      candidates.push(`https://journals.plos.org/${journal}/article/file?id=${doi}&type=printable`);
    }
    candidates.push(`https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`);
    candidates.push(`https://journals.plos.org/ploscompbiol/article/file?id=${doi}&type=printable`);
  }

  if (doi.startsWith("10.48550/arXiv.")) {
    candidates.push(`https://arxiv.org/pdf/${doi.replace(/^10\.48550\/arXiv\./i, "")}`);
  }

  if (/^https?:\/\/arxiv\.org\/abs\//i.test(sourceURL)) {
    candidates.push(sourceURL.replace("/abs/", "/pdf/"));
  }

  const pmcMatch = sourceURL.match(/\/articles\/(PMC\d+)/i);
  if (pmcMatch) {
    candidates.push(`https://pmc.ncbi.nlm.nih.gov/articles/${pmcMatch[1]}/pdf/`);
  }

  candidates.push(sourceURL);
  return [...new Set(candidates.filter(Boolean))];
}

function extractPDFLinks(html, baseURL) {
  const links = [];
  const metaPattern = /<meta[^>]+(?:name|property)=["'](?:citation_pdf_url|og:pdf)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  const contentFirstPattern = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:citation_pdf_url|og:pdf)["'][^>]*>/gi;
  const hrefPattern = /<a[^>]+href=["']([^"']+(?:\.pdf|\/pdf|\/pdfdirect|type=printable)[^"']*)["'][^>]*>/gi;

  for (const pattern of [metaPattern, contentFirstPattern, hrefPattern]) {
    for (const match of html.matchAll(pattern)) {
      const url = absoluteURL(match[1].replaceAll("&amp;", "&"), baseURL);
      if (url) links.push(url);
    }
  }

  return [...new Set(links)];
}

async function fetchBytes(url) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    redirect: "follow",
    signal,
    headers: {
      "user-agent": userAgent,
      "accept": "application/pdf,text/html;q=0.9,*/*;q=0.8"
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    ok: response.ok,
    status: response.status,
    finalURL: response.url,
    contentType,
    buffer
  };
}

function fetchPDFWithCurl(url) {
  const cookiePath = path.join(os.tmpdir(), `pdf-download-cookies-${sha256(Buffer.from(url)).slice(0, 16)}.txt`);
  const buffer = execFileSync("curl", [
    "-fsSL",
    "-c",
    cookiePath,
    "-b",
    cookiePath,
    "-A",
    userAgent,
    "-H",
    "accept: application/pdf,text/html;q=0.9,*/*;q=0.8",
    url
  ], {
    maxBuffer: 256 * 1024 * 1024
  });

  return {
    finalURL: url,
    contentType: "",
    buffer
  };
}

function isPDF(buffer, contentType) {
  return buffer.subarray(0, 5).toString("utf8") === "%PDF-" || /application\/pdf/i.test(contentType);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function downloadTarget(target) {
  const attempts = [];
  const reason = skipReason(target);
  if (reason) {
    return {
      ...target,
      downloaded: false,
      skipped: true,
      skip_reason: reason,
      attempts
    };
  }

  const queue = candidatesFor(target);
  const seen = new Set(queue);

  for (let index = 0; index < queue.length; index += 1) {
    const url = queue[index];

    try {
      const result = await fetchBytes(url);
      attempts.push({
        url,
        status: result.status,
        final_url: result.finalURL,
        content_type: result.contentType,
        bytes: result.buffer.length
      });

      if (result.ok && isPDF(result.buffer, result.contentType)) {
        const pdfPath = path.join(rootDir, target.pdf_path);
        fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
        fs.writeFileSync(pdfPath, result.buffer);

        return {
          ...target,
          downloaded: true,
          downloaded_from: result.finalURL,
          bytes: result.buffer.length,
          sha256: sha256(result.buffer),
          attempts
        };
      }

      if (/^https:\/\/www\.nature\.com\/articles\/[^?#]+\.pdf/i.test(url)) {
        const curlResult = fetchPDFWithCurl(url);
        attempts.push({
          url,
          transport: "curl-cookie-jar",
          final_url: curlResult.finalURL,
          content_type: curlResult.contentType,
          bytes: curlResult.buffer.length
        });

        if (isPDF(curlResult.buffer, curlResult.contentType)) {
          const pdfPath = path.join(rootDir, target.pdf_path);
          fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
          fs.writeFileSync(pdfPath, curlResult.buffer);

          return {
            ...target,
            downloaded: true,
            downloaded_from: curlResult.finalURL,
            bytes: curlResult.buffer.length,
            sha256: sha256(curlResult.buffer),
            attempts
          };
        }
      }

      if (result.ok && /text\/html/i.test(result.contentType)) {
        const html = result.buffer.toString("utf8");
        for (const pdfLink of extractPDFLinks(html, result.finalURL)) {
          if (!seen.has(pdfLink)) {
            seen.add(pdfLink);
            queue.push(pdfLink);
          }
        }
      }
    } catch (error) {
      attempts.push({
        url,
        error: error.message
      });
    }
  }

  return {
    ...target,
    downloaded: false,
    attempts
  };
}

const targets = targetList();
const results = [];
let nextIndex = 0;

async function worker(workerIndex) {
  while (nextIndex < targets.length) {
    const index = nextIndex;
    nextIndex += 1;
    const target = targets[index];
    console.error(`[${index + 1}/${targets.length}] worker ${workerIndex}: ${target.title}`);
    results[index] = await downloadTarget(target);
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, targets.length) }, (_, index) => worker(index + 1))
);

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  scope,
  total: results.length,
  downloaded: results.filter((result) => result.downloaded),
  skipped: results.filter((result) => result.skipped),
  failed: results.filter((result) => !result.downloaded && !result.skipped)
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  report_path: path.relative(rootDir, reportPath),
  downloaded: report.downloaded.length,
  failed: report.failed.length
}, null, 2));
