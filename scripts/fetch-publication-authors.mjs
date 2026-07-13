import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const publicationsPath = path.join(rootDir, "db", "publications.json");
const publicationAuthorsPath = path.join(
  rootDir,
  "db",
  "publication-authors.json"
);
const authorOrcidsPath = path.join(rootDir, "db", "author-orcids.json");
const crossrefUserAgent =
  "sbooeshaghi.github.io citation metadata build (mailto:sina@caltech.edu)";

const publications = JSON.parse(fs.readFileSync(publicationsPath, "utf8"));
const existingPublicationAuthors = fs.existsSync(publicationAuthorsPath)
  ? JSON.parse(fs.readFileSync(publicationAuthorsPath, "utf8"))
  : null;
const authorOrcidOverrides = fs.existsSync(authorOrcidsPath)
  ? JSON.parse(fs.readFileSync(authorOrcidsPath, "utf8"))
  : { authors: [] };

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function doiFromURL(value) {
  return String(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

function normalizeName(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedNameParts(value) {
  return normalizeName(value)
    .split(" ")
    .filter((part) => part && part.length > 1);
}

function authorNamesMatch(left, right) {
  const leftKey = normalizeName(left);
  const rightKey = normalizeName(right);

  if (!leftKey || !rightKey) {
    return false;
  }

  if (leftKey === rightKey) {
    return true;
  }

  const leftParts = normalizedNameParts(left);
  const rightParts = normalizedNameParts(right);

  if (!leftParts.length || !rightParts.length) {
    return false;
  }

  const leftLast = leftParts.at(-1);
  const rightLast = rightParts.at(-1);

  if (leftLast !== rightLast) {
    return false;
  }

  const leftFirst = leftParts[0];
  const rightFirst = rightParts[0];

  return leftFirst === rightFirst || leftFirst[0] === rightFirst[0];
}

function authorNamesStronglyMatch(left, right) {
  const leftParts = normalizedNameParts(left);
  const rightParts = normalizedNameParts(right);

  if (!leftParts.length || !rightParts.length) {
    return false;
  }

  return leftParts[0] === rightParts[0] && leftParts.at(-1) === rightParts.at(-1);
}

function normalizeORCID(value) {
  if (!value) {
    return "";
  }

  const match = String(value).match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/i);
  return match ? `https://orcid.org/${match[0].toUpperCase()}` : "";
}

function authorName(author) {
  return (
    [author.given || "", author.family || ""].filter(Boolean).join(" ").trim() ||
    author.name ||
    ""
  );
}

async function fetchCrossrefWork(doi) {
  const response = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": crossrefUserAgent,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()).message;
}

function parseAuthors(message) {
  return (message.author || [])
    .map((author) => ({
      name: authorName(author),
      orcid: normalizeORCID(author.ORCID || author.orcid),
    }))
    .filter((author) => author.name);
}

function uniqueAuthors(authors) {
  const seen = new Set();
  const unique = [];

  for (const author of authors) {
    const key = normalizeName(author.name);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(author);
  }

  return unique;
}

function backfillORCIDsAcrossVersions(versions) {
  for (const version of versions) {
    for (const author of version.authors) {
      if (author.orcid) {
        continue;
      }

      const matches = versions
        .flatMap((otherVersion) => otherVersion.authors)
        .filter(
          (candidate) =>
            candidate.orcid && authorNamesMatch(author.name, candidate.name)
        );

      const uniqueORCIDs = [...new Set(matches.map((match) => match.orcid))];

      if (uniqueORCIDs.length === 1) {
        author.orcid = uniqueORCIDs[0];
      }
    }
  }
}

function allVersionAuthors(works) {
  return Object.values(works).flatMap((work) =>
    work.versions.flatMap((version) => version.authors)
  );
}

function uniqueORCID(value) {
  const orcids = [...new Set(value)].filter(Boolean);
  return orcids.length === 1 ? orcids[0] : "";
}

function backfillORCIDsAcrossWorks(works) {
  const authorsWithORCID = allVersionAuthors(works).filter((author) =>
    Boolean(author.orcid)
  );
  const exactORCIDsByName = new Map();

  for (const author of authorsWithORCID) {
    const key = normalizeName(author.name);

    if (!exactORCIDsByName.has(key)) {
      exactORCIDsByName.set(key, new Set());
    }

    exactORCIDsByName.get(key).add(author.orcid);
  }

  for (const author of allVersionAuthors(works)) {
    if (author.orcid) {
      continue;
    }

    const exactORCID = uniqueORCID(
      exactORCIDsByName.get(normalizeName(author.name)) || []
    );

    if (exactORCID) {
      author.orcid = exactORCID;
      continue;
    }

    const matchingORCID = uniqueORCID(
      authorsWithORCID
        .filter((candidate) =>
          authorNamesStronglyMatch(author.name, candidate.name)
        )
        .map((candidate) => candidate.orcid)
    );

    if (matchingORCID) {
      author.orcid = matchingORCID;
    }
  }
}

function applyAuthorOrcidOverrides(works) {
  const byName = new Map();

  for (const author of authorOrcidOverrides.authors || []) {
    const key = normalizeName(author.name);
    const orcid = normalizeORCID(author.orcid);

    if (!key || key !== author.normalizedName || !orcid) {
      throw new Error(
        `Invalid author ORCID override: ${author.name || "<unnamed>"}`
      );
    }

    const existing = byName.get(key);
    if (existing && existing !== orcid) {
      throw new Error(`Conflicting author ORCID overrides for ${author.name}`);
    }
    byName.set(key, orcid);
  }

  for (const author of allVersionAuthors(works)) {
    const override = byName.get(normalizeName(author.name));
    if (!override) {
      continue;
    }
    if (author.orcid && author.orcid !== override) {
      throw new Error(
        `Author ORCID override conflicts with Crossref for ${author.name}`
      );
    }
    author.orcid = override;
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  sources: [
    "Crossref DOI metadata with cross-version and cross-work ORCID backfill",
    "Authorlink unique exact-name ORCID overrides",
  ],
  works: {},
};
const failures = [];

for (const publication of publications) {
  const slug = slugify(publication.title);
  const versions = [];

  for (const link of publication.links || []) {
    const doi = doiFromURL(link.doi);

    try {
      const message = await fetchCrossrefWork(doi);
      const authors = parseAuthors(message);

      versions.push({
        name: link.name,
        doi,
        date: link.date,
        authors: uniqueAuthors(authors).map((author) => {
          if (!author.orcid) {
            return { name: author.name };
          }

          return author;
        }),
      });
    } catch (error) {
      failures.push(`${publication.title} ${doi}: ${error.message}`);
    }
  }

  backfillORCIDsAcrossVersions(versions);

  output.works[slug] = {
    title: publication.title,
    versions,
  };
}

backfillORCIDsAcrossWorks(output.works);
applyAuthorOrcidOverrides(output.works);

const authorCount = Object.values(output.works).reduce(
  (sum, work) =>
    sum +
    work.versions.reduce(
      (versionSum, version) => versionSum + version.authors.length,
      0
    ),
  0
);

if (
  failures.length &&
  existingPublicationAuthors &&
  process.env.AUTHOR_FETCH_ALLOW_PARTIAL !== "1"
) {
  console.error(failures.join("\n"));
  console.error(
    "Refusing to overwrite publication-authors.json with a partial Crossref result. " +
      "Set AUTHOR_FETCH_ALLOW_PARTIAL=1 to override."
  );
  process.exit(1);
}

fs.writeFileSync(
  publicationAuthorsPath,
  `${JSON.stringify(output, null, 2)}\n`
);
const orcidCount = Object.values(output.works).reduce(
  (sum, work) =>
    sum +
    work.versions.reduce(
      (versionSum, version) =>
        versionSum +
        version.authors.filter((author) => Boolean(author.orcid)).length,
      0
    ),
  0
);

console.log(
  `Wrote ${publicationAuthorsPath} with ${authorCount} authors and ${orcidCount} ORCID links.`
);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
