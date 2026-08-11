(function () {
  const PANEL_ID = "sbe-scholar-export";
  const CRAWL_KEY = "sbe-scholar-cited-by-crawl-v1";
  const BATCH_KEY = "sbe-scholar-cited-by-batch-v1";
  const WORK_INDEX_KEY = "sbe-scholar-work-index-v1";
  const PROFILE_LOAD_MIN_MS = 1500;
  const PROFILE_LOAD_MAX_MS = 3000;
  const PAGE_DELAY_MIN_MS = 10000;
  const PAGE_DELAY_MAX_MS = 22000;
  const WORK_DELAY_MIN_MS = 30000;
  const WORK_DELAY_MAX_MS = 65000;

  function text(node) {
    return (node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function waitRandom(min, max) {
    return wait(randomInt(min, max));
  }

  function absoluteURL(href) {
    if (!href) return "";
    try {
      return new URL(href, window.location.href).toString();
    } catch (_error) {
      return "";
    }
  }

  function getURLParam(url, name) {
    try {
      return new URL(url).searchParams.get(name) || "";
    } catch (_error) {
      return "";
    }
  }

  function currentURLParam(name) {
    return getURLParam(window.location.href, name);
  }

  function intFromText(value) {
    const match = String(value || "").replace(/,/g, "").match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function yearFromText(value) {
    const matches = String(value || "").match(/\b(?:19|20)\d{2}\b/g);
    return matches ? Number(matches[matches.length - 1]) : null;
  }

  function normalizeKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function sanitizeFilename(value) {
    return String(value || "scholar-export")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "scholar-export";
  }

  function readJSONStorage(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function writeJSONStorage(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function isProfilePage() {
    return window.location.pathname === "/citations" && Boolean(currentURLParam("user"));
  }

  function isScholarResultsPage() {
    return window.location.pathname === "/scholar";
  }

  function isRobotCheckPage() {
    const body = text(document.body).toLowerCase();
    return (
      window.location.pathname.startsWith("/sorry/") ||
      Boolean(document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, #captcha, form[action*="/sorry/"]')) ||
      body.includes("unusual traffic") ||
      body.includes("not a robot") ||
      body.includes("recaptcha")
    );
  }

  function robotCheckMessage() {
    return "Scholar robot check detected. Complete it manually, then click Resume Crawl or retry later.";
  }

  function profileWorks() {
    return Array.from(document.querySelectorAll("tr.gsc_a_tr"))
      .map((row) => {
        const titleAnchor = row.querySelector(".gsc_a_at");
        const gray = row.querySelectorAll(".gs_gray");
        const citedAnchor = row.querySelector(".gsc_a_ac");
        const workLink = absoluteURL(titleAnchor ? titleAnchor.getAttribute("href") : "");
        const citedByLink = absoluteURL(citedAnchor ? citedAnchor.getAttribute("href") : "");
        return {
          title: text(titleAnchor),
          authors: text(gray[0]),
          venue: text(gray[1]),
          year: yearFromText(text(row.querySelector(".gsc_a_y"))),
          citations: intFromText(text(citedAnchor)),
          workLink,
          citedByLink,
          citationId: getURLParam(workLink, "citation_for_view"),
          clusterId: getURLParam(citedByLink, "cites")
        };
      })
      .filter((work) => work.title);
  }

  function saveWorkIndex(works) {
    const index = readJSONStorage(window.localStorage, WORK_INDEX_KEY, { byClusterId: {}, byTitle: {} });
    if (!index.byClusterId) index.byClusterId = {};
    if (!index.byTitle) index.byTitle = {};

    works.forEach((work) => {
      const stored = {
        title: work.title,
        workLink: work.workLink,
        citedByLink: work.citedByLink,
        clusterId: work.clusterId
      };
      if (work.clusterId) index.byClusterId[work.clusterId] = stored;
      index.byTitle[normalizeKey(work.title)] = stored;
    });

    writeJSONStorage(window.localStorage, WORK_INDEX_KEY, index);
  }

  async function loadMoreProfileRows(setStatus) {
    let clicks = 0;
    while (true) {
      const button = document.querySelector("#gsc_bpf_more");
      if (!button || button.disabled || button.getAttribute("disabled") !== null) break;
      button.click();
      clicks += 1;
      setStatus(`Loading more profile rows (${clicks})...`);
      await waitRandom(PROFILE_LOAD_MIN_MS, PROFILE_LOAD_MAX_MS);
      if (clicks >= 200) break;
    }
    const works = profileWorks();
    saveWorkIndex(works);
    setStatus(`Profile rows visible: ${works.length}`);
    return works;
  }

  function exportProfileWorks(setStatus) {
    const works = profileWorks();
    saveWorkIndex(works);
    const userId = currentURLParam("user");
    downloadJSON(`scholar-profile-${userId || "works"}.json`, {
      schemaVersion: 1,
      kind: "profile_works",
      exportedAt: new Date().toISOString(),
      source: "google-scholar-browser",
      profile: {
        userId,
        url: window.location.href
      },
      works
    });
    setStatus(`Exported ${works.length} profile works.`);
  }

  function currentClusterId() {
    return currentURLParam("cites");
  }

  function inferredWork() {
    const clusterId = currentClusterId();
    const index = readJSONStorage(window.localStorage, WORK_INDEX_KEY, { byClusterId: {}, byTitle: {} });
    const stored = clusterId && index.byClusterId ? index.byClusterId[clusterId] : null;
    return {
      title: stored && stored.title ? stored.title : "",
      clusterId,
      citedByLink: window.location.href
    };
  }

  function cleanResultTitle(title) {
    return String(title || "")
      .replace(/^(\s*\[[^\]]+\]\s*)+/, "")
      .replace(/\s+-\s+Google Scholar$/, "")
      .trim();
  }

  function citedByRows() {
    return Array.from(document.querySelectorAll(".gs_r.gs_or.gs_scl"))
      .map((row) => {
        const titleNode = row.querySelector(".gs_rt");
        const titleAnchor = titleNode ? titleNode.querySelector("a") : null;
        return {
          title: cleanResultTitle(text(titleNode)),
          link: absoluteURL(titleAnchor ? titleAnchor.getAttribute("href") : ""),
          year: yearFromText(text(row.querySelector(".gs_a"))),
          summary: ""
        };
      })
      .filter((record) => record.title);
  }

  function citedByExport(records) {
    return {
      schemaVersion: 1,
      kind: "cited_by",
      exportedAt: new Date().toISOString(),
      source: "google-scholar-browser",
      work: inferredWork(),
      cited_by: records
    };
  }

  function exportCurrentCitedByPage(setStatus) {
    const records = citedByRows();
    const work = inferredWork();
    const filenameTitle = work.title || work.clusterId || "cited-by";
    downloadJSON(`scholar-cited-by-${sanitizeFilename(filenameTitle)}.json`, citedByExport(records));
    setStatus(`Exported ${records.length} cited-by records from this page.`);
  }

  function findNextLink() {
    return Array.from(document.querySelectorAll("a")).find((link) => {
      const label = link.getAttribute("aria-label") || "";
      return /^next$/i.test(label) || /^next$/i.test(text(link)) || Boolean(link.querySelector(".gs_ico_nav_next"));
    });
  }

  function recordKey(record) {
    return `${normalizeKey(record.title)}|${record.year || ""}|${record.link || ""}`;
  }

  function activeCrawl() {
    return readJSONStorage(window.sessionStorage, CRAWL_KEY, null);
  }

  function setActiveCrawl(value) {
    if (value) {
      writeJSONStorage(window.sessionStorage, CRAWL_KEY, value);
    } else {
      window.sessionStorage.removeItem(CRAWL_KEY);
    }
  }

  function activeBatch() {
    return readJSONStorage(window.sessionStorage, BATCH_KEY, null);
  }

  function setActiveBatch(value) {
    if (value) {
      writeJSONStorage(window.sessionStorage, BATCH_KEY, value);
    } else {
      window.sessionStorage.removeItem(BATCH_KEY);
    }
  }

  function compactWork(work) {
    return {
      title: work.title,
      authors: work.authors,
      venue: work.venue,
      year: work.year,
      citations: work.citations,
      workLink: work.workLink,
      citedByLink: work.citedByLink,
      citationId: work.citationId,
      clusterId: work.clusterId
    };
  }

  function workKey(work) {
    return work && work.clusterId ? `cluster:${work.clusterId}` : `title:${normalizeKey(work && work.title)}`;
  }

  function batchWorkResults(state) {
    const resultByWork = new Map();
    (state.results || []).forEach((result) => {
      resultByWork.set(workKey(result.work), result);
    });

    const profileWorks = Array.isArray(state.profileWorks) ? state.profileWorks : [];
    const merged = profileWorks.map((work) => {
      const result = resultByWork.get(workKey(work));
      return {
        work,
        cited_by: result && Array.isArray(result.cited_by) ? result.cited_by : []
      };
    });

    (state.results || []).forEach((result) => {
      if (!profileWorks.some((work) => workKey(work) === workKey(result.work))) {
        merged.push(result);
      }
    });

    return merged;
  }

  function downloadBatch(state, setStatus) {
    const userId = state.profile && state.profile.userId ? state.profile.userId : "profile";
    const profileWorks = Array.isArray(state.profileWorks) ? state.profileWorks : [];
    const works = batchWorkResults(state);
    setActiveBatch(null);
    downloadJSON(`scholar-cited-by-all-${sanitizeFilename(userId)}.json`, {
      schemaVersion: 1,
      kind: "cited_by_batch",
      exportedAt: new Date().toISOString(),
      source: "google-scholar-browser",
      profile: state.profile || {},
      profileWorks,
      works
    });
    setStatus(`Finished all-works crawl: ${works.length} works exported.`);
  }

  async function openCurrentBatchWork(state, setStatus) {
    if (!Array.isArray(state.queue)) {
      setActiveBatch(null);
      setStatus("All-works crawl state was invalid and has been cleared.");
      return;
    }
    const work = state.queue[state.currentIndex];
    if (!work) {
      downloadBatch(state, setStatus);
      return;
    }

    state.current = {
      work,
      pageCount: 0,
      seenUrls: [],
      records: []
    };
    setActiveBatch(state);
    setStatus(`Opening work ${state.currentIndex + 1} of ${state.queue.length} after a delay: ${work.title}`);
    await waitRandom(WORK_DELAY_MIN_MS, WORK_DELAY_MAX_MS);
    window.location.href = work.citedByLink;
  }

  async function startBatchCrawl(setStatus) {
    const existing = activeBatch();
    if (existing && existing.active) {
      setStatus("An all-works cited-by crawl is already active.");
      return;
    }

    setActiveCrawl(null);
    const works = await loadMoreProfileRows(setStatus);
    const profileWorks = works.map(compactWork);
    const queue = profileWorks.filter((work) => work.citedByLink && work.clusterId);

    const state = {
      active: true,
      startedAt: new Date().toISOString(),
      profile: {
        userId: currentURLParam("user"),
        url: window.location.href
      },
      currentIndex: 0,
      maxPagesPerWork: 100,
      profileWorks,
      queue,
      results: [],
      current: null
    };
    setActiveBatch(state);

    if (queue.length === 0) {
      downloadBatch(state, setStatus);
      return;
    }

    await openCurrentBatchWork(state, setStatus);
  }

  function stopBatch(setStatus) {
    const state = activeBatch();
    setActiveBatch(null);
    if (!state) {
      setStatus("No all-works crawl is active.");
      return;
    }
    const completed = state.results ? state.results.length : 0;
    setStatus(`Stopped all-works crawl after ${completed} completed works.`);
  }

  async function finishCurrentBatchWork(state, setStatus) {
    if (!Array.isArray(state.results)) state.results = [];
    if (state.current) {
      state.results.push({
        work: state.current.work,
        cited_by: state.current.records || []
      });
    }
    state.currentIndex += 1;
    state.current = null;
    setActiveBatch(state);

    if (state.currentIndex >= state.queue.length) {
      downloadBatch(state, setStatus);
      return;
    }

    await openCurrentBatchWork(state, setStatus);
  }

  function resumeBatch(setStatus) {
    const state = activeBatch();
    if (!state || !state.active) {
      setStatus("No all-works crawl is active.");
      return;
    }
    continueBatch(setStatus);
  }

  async function continueBatch(setStatus) {
    const state = activeBatch();
    if (!state || !state.active) return;

    if (isRobotCheckPage()) {
      setStatus(robotCheckMessage());
      return;
    }

    if (!state.current) {
      await openCurrentBatchWork(state, setStatus);
      return;
    }

    if (!isScholarResultsPage()) {
      setStatus("All-works crawl is active, but this is not a Scholar results page.");
      return;
    }

    const expectedClusterId = state.current.work && state.current.work.clusterId;
    const pageClusterId = currentClusterId();
    if (expectedClusterId && pageClusterId && expectedClusterId !== pageClusterId) {
      setStatus("All-works crawl paused because the current cited-by page does not match the queued work.");
      return;
    }

    const rows = citedByRows();
    if (!Array.isArray(state.current.records)) state.current.records = [];
    if (!Array.isArray(state.current.seenUrls)) state.current.seenUrls = [];
    const seen = new Set((state.current.records || []).map(recordKey));
    rows.forEach((record) => {
      const key = recordKey(record);
      if (!seen.has(key)) {
        state.current.records.push(record);
        seen.add(key);
      }
    });
    state.current.pageCount += 1;
    state.current.seenUrls.push(window.location.href);
    setActiveBatch(state);

    const nextLink = findNextLink();
    if (!nextLink || state.current.pageCount >= state.maxPagesPerWork) {
      setStatus(
        `Finished work ${state.currentIndex + 1} of ${state.queue.length}: ${state.current.records.length} records.`
      );
      await waitRandom(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS);
      await finishCurrentBatchWork(state, setStatus);
      return;
    }

    setStatus(
      `All-works crawl ${state.currentIndex + 1}/${state.queue.length}: ${state.current.records.length} records, page ${state.current.pageCount}. Opening next page after a delay...`
    );
    await waitRandom(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS);
    nextLink.click();
  }

  function startCrawl(setStatus) {
    const existing = activeCrawl();
    if (existing && existing.active) {
      setStatus("A cited-by crawl is already active.");
      return;
    }
    if (activeBatch()) {
      setStatus("Stop the all-works crawl before starting a single-work crawl.");
      return;
    }
    const state = {
      active: true,
      startedAt: new Date().toISOString(),
      work: inferredWork(),
      pageCount: 0,
      maxPages: 100,
      seenUrls: [],
      records: []
    };
    setActiveCrawl(state);
    setStatus("Started cited-by crawl.");
    continueCrawl(setStatus);
  }

  function stopCrawl(setStatus) {
    const state = activeCrawl();
    const batch = activeBatch();
    setActiveCrawl(null);
    setActiveBatch(null);
    if (batch) {
      setStatus(`Stopped all-works crawl after ${batch.results ? batch.results.length : 0} completed works.`);
      return;
    }
    setStatus(state && state.records ? `Stopped crawl after ${state.records.length} records.` : "No active crawl.");
  }

  async function continueCrawl(setStatus) {
    const state = activeCrawl();
    if (!state || !state.active) return;

    if (isRobotCheckPage()) {
      setStatus(robotCheckMessage());
      return;
    }

    if (!isScholarResultsPage()) return;

    const rows = citedByRows();
    const seen = new Set(state.records.map(recordKey));
    rows.forEach((record) => {
      const key = recordKey(record);
      if (!seen.has(key)) {
        state.records.push(record);
        seen.add(key);
      }
    });
    state.pageCount += 1;
    state.seenUrls.push(window.location.href);
    setActiveCrawl(state);

    const nextLink = findNextLink();
    if (!nextLink || state.pageCount >= state.maxPages) {
      const work = state.work || inferredWork();
      const filenameTitle = work.title || work.clusterId || "cited-by";
      setActiveCrawl(null);
      downloadJSON(`scholar-cited-by-${sanitizeFilename(filenameTitle)}.json`, {
        schemaVersion: 1,
        kind: "cited_by",
        exportedAt: new Date().toISOString(),
        source: "google-scholar-browser",
        work,
        cited_by: state.records
      });
      setStatus(`Finished crawl: ${state.records.length} records from ${state.pageCount} pages.`);
      return;
    }

    setStatus(`Captured ${state.records.length} records from ${state.pageCount} pages. Opening next page after a delay...`);
    await waitRandom(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS);
    nextLink.click();
  }

  function makeButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    const title = document.createElement("p");
    title.className = "sbe-title";
    title.textContent = "Scholar Export";

    const actions = document.createElement("div");
    actions.className = "sbe-actions";

    const status = document.createElement("div");
    status.className = "sbe-status";
    const setStatus = (message) => {
      status.textContent = message;
    };

    if (isProfilePage()) {
      actions.appendChild(makeButton("Load More", () => loadMoreProfileRows(setStatus)));
      actions.appendChild(makeButton("Export Works JSON", () => exportProfileWorks(setStatus)));
      actions.appendChild(makeButton("Export Works + Cited-By", () => startBatchCrawl(setStatus)));
      if (activeBatch()) {
        actions.appendChild(makeButton("Resume Crawl", () => resumeBatch(setStatus)));
        actions.appendChild(makeButton("Stop Crawl", () => stopBatch(setStatus)));
      }
      setStatus(`${profileWorks().length} profile rows visible.`);
    } else if (isScholarResultsPage() && currentClusterId()) {
      const batch = activeBatch();
      if (batch && batch.active) {
        actions.appendChild(makeButton("Resume Crawl", () => resumeBatch(setStatus)));
        actions.appendChild(makeButton("Stop Crawl", () => stopBatch(setStatus)));
        setStatus(`All-works crawl active: work ${batch.currentIndex + 1} of ${batch.queue.length}.`);
      } else {
        actions.appendChild(makeButton("Export This Page", () => exportCurrentCitedByPage(setStatus)));
        actions.appendChild(makeButton("Start Cited-By Crawl", () => startCrawl(setStatus)));
        actions.appendChild(makeButton("Stop Crawl", () => stopCrawl(setStatus)));
        const work = inferredWork();
        setStatus(work.title ? `Cited-by page for: ${work.title}` : "Cited-by page detected.");
      }
    } else {
      if (activeBatch()) {
        actions.appendChild(makeButton("Resume Crawl", () => resumeBatch(setStatus)));
        actions.appendChild(makeButton("Stop Crawl", () => stopBatch(setStatus)));
        setStatus("All-works crawl is active, but this is not a cited-by results page.");
      } else {
        setStatus("Open a Scholar profile or cited-by page.");
      }
    }

    panel.appendChild(title);
    panel.appendChild(actions);
    panel.appendChild(status);
    document.body.appendChild(panel);

    const batch = activeBatch();
    const crawl = activeCrawl();
    if (batch && batch.active) {
      window.setTimeout(() => continueBatch(setStatus), 600);
    } else if (crawl && crawl.active) {
      window.setTimeout(() => continueCrawl(setStatus), 600);
    }
  }

  renderPanel();
})();
