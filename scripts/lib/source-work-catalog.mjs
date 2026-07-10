import path from "node:path";
import {
  normalizeDoi,
  readJSON,
  rootPath,
  slugify,
} from "../../tools/sciindex/bundles/scientific-literature/tasks/paper/lib/common.mjs";

export function sourceWorkDoiCatalog({
  publicationsPath = rootPath("db", "publications.json"),
} = {}) {
  const publications = readJSON(publicationsPath, []);
  const entries = [];

  for (const publication of publications) {
    const workSlug = slugify(publication.title);
    const versions = publication.versions?.length
      ? publication.versions
      : publication.links || [];
    const versionYears = versions
      .map((link) => String(link.date || "").match(/\b(19|20)\d{2}\b/)?.[0])
      .filter(Boolean);

    for (const link of versions) {
      const doi = normalizeDoi(link.doi || link.url);
      if (!doi) continue;

      entries.push({
        doi,
        doi_url: `https://doi.org/${doi}`,
        work_slug: workSlug,
        work_title: publication.title,
        version_title: link.title || publication.title,
        version_name: link.name || "",
        version_date: link.date || "",
        version_years: [...new Set(versionYears)].sort(),
      });
    }
  }

  return entries.sort(
    (a, b) =>
      a.work_title.localeCompare(b.work_title) ||
      a.doi.localeCompare(b.doi)
  );
}

export function sourceWorkCatalogByDoi(options = {}) {
  const grouped = new Map();
  for (const entry of sourceWorkDoiCatalog(options)) {
    const doi = normalizeDoi(entry.doi);
    const current = grouped.get(doi) || { ...entry, titles: [] };
    current.titles = [...new Set([
      ...current.titles,
      entry.work_title,
      entry.version_title,
    ].filter(Boolean))];
    grouped.set(doi, current);
  }
  return grouped;
}

export function relativeToRoot(filePath) {
  return path.relative(rootPath(), filePath);
}
