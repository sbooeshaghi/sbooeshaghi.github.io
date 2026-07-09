(() => {
  const root = document.querySelector("[data-work-relations]");
  const dataElement = document.getElementById("workRelationData");
  if (!root || !dataElement) return;

  const data = JSON.parse(dataElement.textContent);
  const relationTypes = data.relationTypes || [];
  const connections = data.connections || [];
  let selectedType =
    relationTypes.find((type) => connections.some((connection) => connection.type === type.id))
      ?.id || relationTypes[0]?.id || "";
  let selectedId = connections.find((connection) => connection.type === selectedType)?.id || "";

  const relationTabs = root.querySelector("[data-relation-tabs]");
  const relationList = root.querySelector("[data-relation-list]");
  const detailLabel = root.querySelector("[data-relation-label]");
  const detailTitle = root.querySelector("[data-relation-title]");
  const detailStatement = root.querySelector("[data-relation-statement]");
  const evidenceDetails = root.querySelector("[data-relation-evidence]");
  const evidenceSummary = root.querySelector("[data-evidence-summary]");
  const evidenceRows = root.querySelector("[data-evidence-rows]");
  const versionCitation = root.querySelector("[data-version-citation]");
  const bibtexCode = root.querySelector("[data-bibtex-code]");
  const copyBibTeX = root.querySelector("[data-copy-bibtex]");

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function visibleConnections() {
    return connections.filter((connection) => connection.type === selectedType);
  }

  function selectedConnection() {
    return visibleConnections().find((connection) => connection.id === selectedId) || null;
  }

  function selectedRelationType() {
    return relationTypes.find((type) => type.id === selectedType);
  }

  function sourceLabel(evidence) {
    const page = Number.isInteger(evidence.page) ? `p. ${evidence.page}` : "";
    const source = String(evidence.source || "")
      .replace(/^source:(?:pdf|text):/, "")
      .replace(/^document:/, "")
      .replaceAll("-", " ");
    return [page, source].filter(Boolean).join(" · ") || "Source text";
  }

  function renderTabs() {
    relationTabs.innerHTML = relationTypes
      .map((type) => {
        const count = connections.filter((connection) => connection.type === type.id).length;
        const selected = type.id === selectedType;
        return `
          <button
            class="relation-tab${selected ? " is-selected" : ""}"
            type="button"
            role="tab"
            aria-selected="${selected}"
            data-relation-type="${escapeHTML(type.id)}"
          >
            <span>${escapeHTML(type.label)}</span>
            <span class="relation-tab-count">${count}</span>
          </button>`;
      })
      .join("");

    relationTabs.querySelectorAll("[data-relation-type]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedType = button.dataset.relationType;
        selectedId = visibleConnections()[0]?.id || "";
        render();
      });
    });
  }

  function renderList() {
    const visible = visibleConnections();
    relationList.innerHTML = visible.length
      ? visible
          .map(
            (connection) => `
              <button
                class="reason-card${connection.id === selectedId ? " is-selected" : ""}"
                type="button"
                aria-pressed="${connection.id === selectedId}"
                data-relation-id="${escapeHTML(connection.id)}"
              >
                <span class="reason-card-title">${escapeHTML(connection.title)}</span>
                <span class="reason-card-reason">${escapeHTML(connection.description)}</span>
              </button>`
          )
          .join("")
      : '<p class="relation-empty">No indexed relations of this kind yet.</p>';

    relationList.querySelectorAll("[data-relation-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedId = button.dataset.relationId;
        renderList();
        renderDetail();
      });
    });
  }

  function renderDetail() {
    const connection = selectedConnection();
    const type = selectedRelationType();
    detailLabel.textContent = type?.label || "Relation";

    if (!connection) {
      detailTitle.textContent = "Nothing indexed yet";
      detailStatement.textContent = "This relation type will appear as the index gains verified objects and connections.";
      evidenceDetails.hidden = true;
      versionCitation.hidden = true;
      return;
    }

    const evidence = connection.evidence || [];
    detailTitle.textContent = connection.title;
    detailStatement.textContent = connection.statement || connection.description;
    versionCitation.hidden = !(connection.type === "versions" && connection.bibtex);
    bibtexCode.textContent = connection.bibtex || "";
    evidenceSummary.textContent = evidence.length === 1 ? "1 span" : `${evidence.length} spans`;
    evidenceRows.innerHTML = evidence.length
      ? evidence
          .map(
            (item) => `
              <tr>
                <td>${escapeHTML(item.span)}</td>
                <td>${escapeHTML(sourceLabel(item))}</td>
              </tr>`
          )
          .join("")
      : '<tr class="relationship-evidence-empty"><td colspan="2">This connection is grounded in accepted metadata.</td></tr>';
    evidenceDetails.hidden = false;
  }

  function render() {
    renderTabs();
    renderList();
    renderDetail();
  }

  copyBibTeX.addEventListener("click", async () => {
    const value = bibtexCode.textContent;
    const original = copyBibTeX.textContent;
    try {
      await navigator.clipboard.writeText(value);
      copyBibTeX.textContent = "Copied";
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copyBibTeX.textContent = document.execCommand("copy") ? "Copied" : "Copy failed";
      textarea.remove();
    }
    window.setTimeout(() => {
      copyBibTeX.textContent = original;
    }, 1200);
  });

  render();
})();
