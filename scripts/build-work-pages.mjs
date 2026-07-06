import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationsPath = path.join(rootDir, "db", "publications.json");
const citedByPath = path.join(rootDir, "db", "cited-by.json");
const publicationAuthorsPath = path.join(
  rootDir,
  "db",
  "publication-authors.json"
);
const worksDir = path.join(rootDir, "works");

const publications = JSON.parse(fs.readFileSync(publicationsPath, "utf8"));
const citedByData = fs.existsSync(citedByPath)
  ? JSON.parse(fs.readFileSync(citedByPath, "utf8"))
  : { works: {} };
const publicationAuthorsData = fs.existsSync(publicationAuthorsPath)
  ? JSON.parse(fs.readFileSync(publicationAuthorsPath, "utf8"))
  : { works: {} };

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

function doiFromURL(value) {
  return String(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

function citationLink(citation) {
  return citation.link || "";
}

function doiLink(doi) {
  return `https://doi.org/${doiFromURL(doi)}`;
}

function publicationVersions(publication) {
  return [...(publication.versions || publication.links || [])].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
}

function versionHref(version) {
  return version.url || version.doi || "";
}

function fallbackBibTeX(link, publication, index) {
  const key = `${slugify(publication.title).replace(/-/g, "_")}_${index + 1}`;
  return [
    `@misc{${key},`,
    `  title = {${publication.title}},`,
    `  doi = {${doiFromURL(link.doi)}},`,
    `  url = {${link.doi}},`,
    `  year = {${link.date.slice(0, 4)}}`,
    "}",
  ].join("\n");
}

function fetchBibTeX(link, publication, index) {
  const doi = doiFromURL(link.doi);

  try {
    return execFileSync("doi2bib", [doi], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    }).trim();
  } catch {
    return fallbackBibTeX(link, publication, index);
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

function bibTeXCopyScript() {
  return `
    <script>
      document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".copy-bibtex-button").forEach((button) => {
          button.addEventListener("click", async () => {
            const box = button.closest(".bibtex-box");
            const code = box ? box.querySelector("code") : null;
            const bibtex = code ? code.textContent : "";
            const previousText = button.textContent;
            const markStatus = (text) => {
              button.textContent = text;
              window.setTimeout(() => {
                button.textContent = previousText;
              }, 1200);
            };
            const copyWithSelection = () => {
              const textarea = document.createElement("textarea");
              textarea.value = bibtex;
              textarea.setAttribute("readonly", "");
              textarea.style.position = "fixed";
              textarea.style.left = "0";
              textarea.style.top = "0";
              textarea.style.width = "1px";
              textarea.style.height = "1px";
              textarea.style.opacity = "0";
              textarea.style.pointerEvents = "none";
              document.body.appendChild(textarea);
              textarea.focus({ preventScroll: true });
              textarea.select();
              textarea.setSelectionRange(0, textarea.value.length);
              const copied = document.execCommand("copy");
              textarea.remove();
              return copied;
            };

            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(bibtex);
                markStatus("Copied");
                return;
              }

              if (copyWithSelection()) {
                markStatus("Copied");
                return;
              }
            } catch {
              let copied = false;

              try {
                copied = copyWithSelection();
              } catch {
                copied = false;
              }

              if (copied) {
                markStatus("Copied");
                return;
              }
            }

            markStatus("Copy failed");
          });
        });
      });
    </script>`;
}

function renderLinks(publication) {
  return publicationVersions(publication)
    .map((version, versionIndex) => {
      const detail = [version.name, version.date].filter(Boolean).join(" · ");

      return `
        <a
          class="publication-version-link${
            versionIndex === 0 ? " is-current" : ""
          }"
          href="${escapeHTML(versionHref(version))}"
          target="_blank"
          rel="noopener"
        >
          <span class="publication-version-title">${escapeHTML(
            version.title || publication.title
          )}</span>
          ${
            detail
              ? `<span class="publication-version-detail">${escapeHTML(
                  detail
                )}</span>`
              : ""
          }
        </a>`;
    })
    .join("");
}

function renderBibTeX(publication) {
  return publication.links
    .map((link, index) => {
      const bibtex = fetchBibTeX(link, publication, index);

      return `
        <section class="bibtex-entry">
          <h3>${escapeHTML(link.name)}</h3>
          <div class="bibtex-box">
            <button
              class="copy-bibtex-button"
              type="button"
              aria-label="Copy BibTeX for ${escapeHTML(link.name)}"
            >
              Copy BibTeX
            </button>
            <pre><code>${escapeHTML(bibtex)}</code></pre>
          </div>
        </section>`;
    })
    .join("");
}

function authorVersions(slug) {
  return publicationAuthorsData.works?.[slug]?.versions || [];
}

function renderAuthor(author) {
  const name = escapeHTML(author.name);

  if (!author.orcid) {
    return name;
  }

  return `<a href="${escapeHTML(
    author.orcid
  )}" target="_blank" rel="noopener" title="ORCID">${name}</a>`;
}

function renderAuthors(slug) {
  const versions = authorVersions(slug);

  if (!versions.length) {
    return `
      <section class="authors-section" data-author-version-count="0">
        <h2>Authors</h2>
        <p class="author-empty">No author metadata found for this work.</p>
      </section>`;
  }

  return `
      <section
        class="authors-section"
        data-author-version-count="${versions.length}"
      >
        <h2>Authors</h2>
        ${versions
          .map((version) => {
            const authors = version.authors || [];

            return `
        <section
          class="author-version"
          data-author-count="${authors.length}"
        >
          <h3>
            <a href="${escapeHTML(
              doiLink(version.doi)
            )}" target="_blank" rel="noopener">${escapeHTML(version.name)}</a>
            ${
              version.date
                ? `<time datetime="${escapeHTML(version.date)}">${escapeHTML(
                    version.date
                  )}</time>`
                : ""
            }
          </h3>
          <ul class="author-list">
            ${authors
              .map(
                (author) => `
            <li>${renderAuthor(author)}</li>`
              )
              .join("")}
          </ul>
        </section>`;
          })
          .join("")}
      </section>`;
}

function citedByRows(slug) {
  return citedByData.works?.[slug]?.cited_by || [];
}

function renderCitingWorks(slug) {
  const citations = citedByRows(slug);

  if (!citations.length) {
    return `
            <tr class="citation-empty">
              <td colspan="3">No citing works found in the current citation data.</td>
            </tr>`;
  }

  return citations
    .map((citation) => {
      const title = escapeHTML(citation.title);
      const link = citationLink(citation);
      const titleMarkup = link
        ? `<a href="${escapeHTML(link)}" target="_blank" rel="noopener">${title}</a>`
        : title;

      return `
            <tr>
              <td class="citation-title">${titleMarkup}</td>
              <td class="citation-year">${
                citation.year
                  ? `<time datetime="${escapeHTML(citation.year)}">${escapeHTML(
                      citation.year
                    )}</time>`
                  : ""
              }</td>
              <td class="citation-summary">${escapeHTML(
                citation.summary || ""
              )}</td>
            </tr>`;
    })
    .join("");
}

function renderPage(publication) {
  const slug = slugify(publication.title);
  const title = escapeHTML(publication.title);
  const summary = escapeHTML(publication.summary);
  const breadcrumbLabel = escapeHTML(truncateBreadcrumbLabel(publication.title));
  const citations = citedByRows(slug);
  const citationCount = citations.length;
  const generatedAt = citedByData.generatedAt
    ? new Date(citedByData.generatedAt).toISOString().slice(0, 10)
    : "";
  const citationSources = citedByData.sources?.length
    ? citedByData.sources.join(", ")
    : "available citation data";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    ${googleTag()}
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${summary}" />
    <link rel="stylesheet" href="../styles.css" />
    ${bibTeXCopyScript()}
    <title>${title} | Works | Sina Booeshaghi</title>
  </head>
  <body>
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="../index.html">Home</a>
      <span aria-hidden="true">/</span>
      <a href="../publications.html">Works</a>
      <span aria-hidden="true">/</span>
      <span class="breadcrumb-current" title="${title}">${breadcrumbLabel}</span>
    </nav>
    <article class="work-page">
      <h1>${title}</h1>
      <div class="publication-versions work-versions" aria-label="Work versions">
        <span class="publication-versions-label">Versions</span>
        <div class="publication-version-cards">
          ${renderLinks(publication)}
        </div>
      </div>

      <section>
        <h2>Summary</h2>
        <p>${summary}</p>
      </section>

      ${renderAuthors(slug)}

      <section>
        <h2>BibTeX</h2>
        ${renderBibTeX(publication)}
      </section>

      <section>
        <h2>Citing Works</h2>
        <p class="citation-source-note">
          ${citationCount} citing work${citationCount === 1 ? "" : "s"} found${
    generatedAt ? ` in citation data generated ${generatedAt}` : ""
  }. Citation relationships are sourced from ${escapeHTML(citationSources)}.
        </p>
        <table class="citation-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Year</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            ${renderCitingWorks(slug)}
          </tbody>
        </table>
      </section>
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
