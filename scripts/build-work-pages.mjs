import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkRelationProjector } from "./lib/work-relation-view.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationsPath = path.join(rootDir, "db", "publications.json");
const citedByPath = path.join(rootDir, "db", "cited-by.json");
const resourceIndexPath = path.join(rootDir, "db", "resource-index.json");
const worksDir = path.join(rootDir, "works");

const publications = JSON.parse(fs.readFileSync(publicationsPath, "utf8"));
const citedByData = fs.existsSync(citedByPath)
  ? JSON.parse(fs.readFileSync(citedByPath, "utf8"))
  : { works: {} };
const resourceIndex = fs.existsSync(resourceIndexPath)
  ? JSON.parse(fs.readFileSync(resourceIndexPath, "utf8"))
  : { objects: [], connections: [], sources: [] };
const projectWorkRelations = createWorkRelationProjector(resourceIndex);
const skipDoi2Bib = process.env.SKIP_DOI2BIB === "1";

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truncateBreadcrumbLabel(value, maxLength = 64) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function serializeJSONForHTML(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function doiFromURL(value) {
  const match = String(value || "").match(/(10\.\d{4,9}\/[^?#\s]+)/i);
  return match
    ? match[1]
        .replace(/v\d+$/i, "")
        .replace(/\.(?:abstract|full|full\.pdf)$/i, "")
        .toLowerCase()
    : "";
}

function versionBibTeX(version, index) {
  const citation = version.citation || {};
  const keyParts = [version.title, citation.date || index + 1].filter(Boolean);
  const key = slugify(keyParts.join(" ")).replace(/-/g, "_");
  const authors = (citation.authors || []).map((author) => author.name).filter(Boolean);
  const fields = [
    `@misc{${key},`,
    `  title = {${version.title}},`,
    authors.length ? `  author = {${authors.join(" and ")}},` : "",
    citation.date ? `  year = {${citation.date.slice(0, 4)}},` : "",
    citation.doi ? `  doi = {${citation.doi}},` : "",
    citation.url ? `  url = {${citation.url}},` : "",
    citation.venue || citation.date
      ? `  note = {${[citation.venue, citation.date].filter(Boolean).join(", ")}}`
      : "",
    "}",
  ].filter(Boolean);
  return fields.join("\n");
}

const bibTeXByDoi = new Map();

function fetchVersionBibTeX(version, index, sharedDoi) {
  const doi = version.citation?.doi || doiFromURL(version.citation?.url);

  if (!doi || sharedDoi || skipDoi2Bib) {
    return versionBibTeX(version, index);
  }

  if (bibTeXByDoi.has(doi)) return bibTeXByDoi.get(doi);

  try {
    const bibtex = execFileSync("doi2bib", [doi], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    }).trim();
    bibTeXByDoi.set(doi, bibtex);
    return bibtex;
  } catch {
    return versionBibTeX(version, index);
  }
}

function googleTag() {
  return `
    <script
      async
      src="https://www.googletagmanager.com/gtag/js?id=G-6P1ZQ0CC8F"
    ></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag("js", new Date());
      gtag("config", "G-6P1ZQ0CC8F");
    </script>`;
}

function addVersionBibTeX(relationData) {
  const versions = relationData.connections.filter((connection) => connection.type === "versions");
  const doiCounts = versions.reduce((counts, version) => {
    const doi = version.citation?.doi || doiFromURL(version.citation?.url);
    if (doi) counts.set(doi, (counts.get(doi) || 0) + 1);
    return counts;
  }, new Map());

  versions.forEach((version, index) => {
    const doi = version.citation?.doi || doiFromURL(version.citation?.url);
    version.bibtex = fetchVersionBibTeX(version, index, Boolean(doi && doiCounts.get(doi) > 1));
  });
}

function citedByRows(slug) {
  return citedByData.works?.[slug]?.cited_by || [];
}

function renderRelationInspector(relationData) {
  return `
      <section class="relationship-inspector" aria-label="Indexed relations" data-work-relations>
        <section class="relationship-list-panel" aria-label="Relations">
          <div class="study-section-heading">
            <h2>Relations</h2>
          </div>
          <div
            class="relation-tabs"
            role="tablist"
            aria-label="Relation types"
            data-relation-tabs
          ></div>
          <div class="reason-list" data-relation-list></div>
        </section>

        <aside class="evidence-panel relationship-detail" aria-live="polite">
          <span class="study-label" data-relation-label>Relation</span>
          <h2 data-relation-title></h2>
          <p class="selected-relation-statement" data-relation-statement></p>
          <section class="version-citation" data-version-citation hidden>
            <h3>Citation</h3>
            <div class="bibtex-box">
              <button class="copy-bibtex-button" type="button" data-copy-bibtex>
                Copy BibTeX
              </button>
              <pre><code data-bibtex-code></code></pre>
            </div>
          </section>
          <details class="relationship-evidence" data-relation-evidence>
            <summary>
              <span>Evidence</span>
              <span class="evidence-summary" data-evidence-summary></span>
            </summary>
            <table class="relationship-evidence-table">
              <thead>
                <tr>
                  <th>Span</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody data-evidence-rows></tbody>
            </table>
          </details>
        </aside>
      </section>
      <script id="workRelationData" type="application/json">${serializeJSONForHTML(
        relationData
      )}</script>
      <script src="../work-relations.js"></script>`;
}

function renderPage(publication) {
  const slug = slugify(publication.title);
  const title = escapeHTML(publication.title);
  const summary = escapeHTML(publication.summary);
  const breadcrumbLabel = escapeHTML(truncateBreadcrumbLabel(publication.title));
  const citations = citedByRows(slug);
  const citationCount = citations.length;
  const relationData = projectWorkRelations(slug);
  addVersionBibTeX(relationData);
  const relationCount = relationData.connections.length;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${googleTag()}
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${summary}" />
    <link rel="stylesheet" href="../styles.css" />
    <title>${title} | Works | Sina Booeshaghi</title>
  </head>
  <body class="work-detail-page">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="../index.html">Home</a>
      <span aria-hidden="true">/</span>
      <a href="../publications.html">Works</a>
      <span aria-hidden="true">/</span>
      <span class="breadcrumb-current" title="${title}">${breadcrumbLabel}</span>
    </nav>
    <article class="work-page study-graph-page">
      <section class="study-focus" aria-label="Selected work">
        <div>
          <h1>${title}</h1>
          <p>${summary}</p>
        </div>
        <dl class="study-stats">
          <div>
            <dt>Citations</dt>
            <dd>${citationCount}</dd>
          </div>
          <div>
            <dt>Relations</dt>
            <dd>${relationCount}</dd>
          </div>
        </dl>
      </section>

      ${renderRelationInspector(relationData)}
    </article>
  </body>
</html>
`;
}

fs.mkdirSync(worksDir, { recursive: true });

for (const publication of publications) {
  const slug = slugify(publication.title);
  fs.writeFileSync(path.join(worksDir, `${slug}.html`), renderPage(publication));
}

console.log(`Generated ${publications.length} work pages in works/`);
