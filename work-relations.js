(() => {
  const root = document.querySelector("[data-work-relations]");
  const dataElement = document.getElementById("workRelationData");
  if (!root || !dataElement) return;

  const data = JSON.parse(dataElement.textContent);
  const relationTypes = data.relationTypes || [];
  const connections = data.connections || [];
  const sourceConnections = new Map(
    connections
      .filter((connection) => connection.type === "sources" && connection.objectId)
      .map((connection) => [connection.objectId, connection])
  );
  let selectedType =
    relationTypes.find((type) => connections.some((connection) => connection.type === type.id))
      ?.id || relationTypes[0]?.id || "";
  let selectedId = connections.find((connection) => connection.type === selectedType)?.id || "";

  const relationTabs = root.querySelector("[data-relation-tabs]");
  const relationList = root.querySelector("[data-relation-list]");
  const detailLabel = root.querySelector("[data-relation-label]");
  const detailTitle = root.querySelector("[data-relation-title]");
  const detailIdentifiers = root.querySelector("[data-relation-identifiers]");
  const detailStatement = root.querySelector("[data-relation-statement]");
  const supportingClaims = root.querySelector("[data-supporting-claims]");
  const supportingClaimList = root.querySelector("[data-supporting-claim-list]");
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

  function truncateText(value, maxLength = 96) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3).trimEnd()}...`;
  }

  function identifierHref(identifier) {
    if (identifier.namespace === "doi") return `https://doi.org/${identifier.value}`;
    if (["orcid", "url"].includes(identifier.namespace)) return identifier.value;
    return "";
  }

  function identifierLabel(identifier) {
    const value = identifier.namespace === "orcid"
      ? identifier.value.replace(/^https:\/\/orcid\.org\//, "")
      : identifier.value;
    return `${identifier.namespace.toUpperCase()}: ${value}`;
  }

  function objectHref(connection) {
    return connection.objectId
      ? `/object.html?id=${encodeURIComponent(connection.objectId)}`
      : "";
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

  function sourceConnection(evidence) {
    const sourceId = String(evidence.source || "");
    const documentId =
      evidence.properties?.document_id || sourceId.replace(/^source:(?:pdf|text):/, "");
    return sourceConnections.get(documentId) || null;
  }

  function sourceCell(evidence) {
    const connection = sourceConnection(evidence);
    const label = escapeHTML(
      connection ? connection.title : sourceLabel({ ...evidence, page: null })
    );
    if (!connection) return label;
    const cardId = `relation-card-${connection.id}`;
    return `<a class="evidence-source-link" href="#${escapeHTML(cardId)}" data-source-relation-id="${escapeHTML(connection.id)}">${label}</a>`;
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
          .map((connection) => {
            const content =
              ["claims", "results"].includes(connection.type)
                ? `<span class="reason-card-reason">${escapeHTML(connection.description)}</span>`
                : `
                  <span class="reason-card-title">${escapeHTML(connection.title)}</span>
                  <span class="reason-card-reason">${escapeHTML(connection.description)}</span>`;
            return `
              <button
                id="relation-card-${escapeHTML(connection.id)}"
                class="reason-card${connection.id === selectedId ? " is-selected" : ""}"
                type="button"
                aria-pressed="${connection.id === selectedId}"
                data-relation-id="${escapeHTML(connection.id)}"
              >
                ${content}
              </button>`;
          })
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
      detailIdentifiers.hidden = true;
      detailStatement.hidden = false;
      detailStatement.textContent = "This relation type will appear as the index gains verified objects and connections.";
      supportingClaims.hidden = true;
      evidenceDetails.hidden = true;
      versionCitation.hidden = true;
      return;
    }

    const evidence = connection.evidence || [];
    const isClaim = connection.type === "claims";
    const isResult = connection.type === "results";
    const title = isClaim || isResult
      ? truncateText(connection.description)
      : connection.title;
    const identifiers = connection.identifiers || [];
    const href = objectHref(connection);
    detailTitle.innerHTML = href
      ? `<a href="${escapeHTML(href)}">${escapeHTML(title)}</a>`
      : escapeHTML(title);
    detailIdentifiers.hidden = !identifiers.length;
    detailIdentifiers.innerHTML = identifiers
      .map((identifier) => {
        const label = escapeHTML(identifierLabel(identifier));
        const href = identifierHref(identifier);
        return href
          ? `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : `<span>${label}</span>`;
      })
      .join("");
    detailStatement.hidden = isClaim;
    detailStatement.textContent = isClaim
      ? ""
      : isResult
        ? connection.description
        : connection.statement || connection.description;
    const claims = connection.supportingClaims || [];
    supportingClaims.hidden = !(isResult && claims.length);
    supportingClaimList.innerHTML = claims
      .map(
        (claim) => `
          <li>
            <button type="button" data-supporting-claim-id="${escapeHTML(claim.objectId)}">
              ${escapeHTML(claim.statement)}
            </button>
          </li>`
      )
      .join("");
    supportingClaimList.querySelectorAll("[data-supporting-claim-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const claim = connections.find(
          (candidate) =>
            candidate.type === "claims" && candidate.objectId === button.dataset.supportingClaimId
        );
        if (!claim) return;
        selectedType = "claims";
        selectedId = claim.id;
        render();
        document.getElementById(`relation-card-${selectedId}`)?.focus({ preventScroll: true });
      });
    });
    versionCitation.hidden = !(connection.type === "versions" && connection.bibtex);
    bibtexCode.textContent = connection.bibtex || "";
    evidenceSummary.textContent = evidence.length === 1 ? "1 span" : `${evidence.length} spans`;
    evidenceRows.innerHTML = evidence.length
      ? evidence
          .map(
            (item) => `
              <tr>
                <td>${escapeHTML(item.span)}</td>
                <td>${sourceCell(item)}</td>
              </tr>`
          )
          .join("")
      : '<tr class="relationship-evidence-empty"><td colspan="2">This connection is grounded in accepted metadata.</td></tr>';
    evidenceRows.querySelectorAll("[data-source-relation-id]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        selectedType = "sources";
        selectedId = link.dataset.sourceRelationId;
        render();
        document.getElementById(`relation-card-${selectedId}`)?.focus({ preventScroll: true });
      });
    });
    evidenceDetails.hidden = isResult;
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
