import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDoi, stableSlug, titlesPlausiblyMatch } from "./common.mjs";

test("long IDs retain a collision-resistant suffix", () => {
  const prefix = "a-very-long-publication-identifier-".repeat(6);
  const first = stableSlug(`${prefix}version-one`);
  const second = stableSlug(`${prefix}version-two`);

  assert.notEqual(first, second);
  assert.ok(first.length <= 110);
  assert.ok(second.length <= 110);
});

test("DOI normalization rejects URLs and extracts embedded DOIs", () => {
  assert.equal(normalizeDoi("https://www.nature.com/articles/s41586-024-07314-2"), "");
  assert.equal(
    normalizeDoi("https://doi.org/10.1093/nar/gkae1137"),
    "10.1093/nar/gkae1137"
  );
  assert.equal(
    normalizeDoi("https://www.biorxiv.org/content/10.1101/2022.05.06.490859v4"),
    "10.1101/2022.05.06.490859"
  );
});

test("title matching tolerates layout artifacts and small inflections", () => {
  assert.equal(
    titlesPlausiblyMatch(
      "Atranscriptomicandepigenomiccellatlasofthemouseprimarymotor cortex",
      "A transcriptomic and epigenomic cell atlas of the mouse primary motor cortex"
    ),
    true
  );
  assert.equal(
    titlesPlausiblyMatch(
      "Systematic cell-type resolved transcriptomes of 8 tissues in 8 mouse strains captures expression variation",
      "Systematic cell-type resolved transcriptomes of 8 tissues in 8 mouse strains capture expression variation"
    ),
    true
  );
  assert.equal(
    titlesPlausiblyMatch(
      "Efficient pre-processing of single-cell ATAC-seq data",
      "Assessing the multimodal tradeoff"
    ),
    false
  );
});
