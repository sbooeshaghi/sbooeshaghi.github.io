(() => {
  const KIND_DETAILS = {
    work: { singular: "Work", plural: "Works", breadcrumb: "Work", order: 0 },
    publication: { singular: "Publication", plural: "Publications", breadcrumb: "Publication", order: 1 },
    person: { singular: "Person", plural: "Authors", breadcrumb: "Author", order: 2 },
    result: { singular: "Result", plural: "Results", breadcrumb: "Result", order: 3 },
    claim: { singular: "Claim", plural: "Claims", breadcrumb: "Claim", order: 4 },
    software: { singular: "Software", plural: "Software", breadcrumb: "Software", order: 5 },
    source_document: { singular: "Source", plural: "Sources", breadcrumb: "Source", order: 6 },
  };

  const status = document.querySelector("[data-object-status]");
  const content = document.querySelector("[data-object-content]");
  const breadcrumb = document.querySelector("[data-object-breadcrumb]");
  const kindBreadcrumb = document.querySelector("[data-object-kind-breadcrumb]");
  const objectKind = document.querySelector("[data-object-kind]");
  const objectTitle = document.querySelector("[data-object-title]");
  const objectDescription = document.querySelector("[data-object-description]");
  const objectIdentifiers = document.querySelector("[data-object-identifiers]");
  const relationCount = document.querySelector("[data-object-relation-count]");
  const kindCount = document.querySelector("[data-object-kind-count]");
  const tabs = document.querySelector("[data-object-tabs]");
  const relationList = document.querySelector("[data-object-relations]");
  const detailKind = document.querySelector("[data-relation-kind]");
  const detailTitle = document.querySelector("[data-relation-title]");
  const detailIdentifiers = document.querySelector("[data-relation-identifiers]");
  const detailStatement = document.querySelector("[data-relation-statement]");
  const evidenceDetails = document.querySelector("[data-relation-evidence]");
  const evidenceSummary = document.querySelector("[data-evidence-summary]");
  const evidenceRows = document.querySelector("[data-evidence-rows]");

  let view;
  let selectedKind = "";
  let selectedRelationId = "";

  function kindDetails(kind) {
    return KIND_DETAILS[kind] || {
      singular: kind.replaceAll("_", " "),
      plural: kind.replaceAll("_", " "),
      breadcrumb: kind.replaceAll("_", " "),
      order: Number.MAX_SAFE_INTEGER,
    };
  }

  function bucketForObjectId(id, bucketCount) {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % bucketCount;
  }

  function objectHref(object) {
    if (object.kind === "work" && object.id.startsWith("work:")) {
      return `works/${encodeURIComponent(object.id.slice("work:".length))}.html`;
    }
    return `object.html?id=${encodeURIComponent(object.id)}`;
  }

  function identifierHref(identifier) {
    if (identifier.namespace === "doi") return `https://doi.org/${identifier.value}`;
    if (identifier.namespace === "orcid") return identifier.value;
    if (["url", "repository"].includes(identifier.namespace) && /^https?:\/\//.test(identifier.value)) {
      return identifier.value;
    }
    if (identifier.namespace === "pmid") {
      return `https://pubmed.ncbi.nlm.nih.gov/${identifier.value}/`;
    }
    if (identifier.namespace === "arxiv") {
      return `https://arxiv.org/abs/${identifier.value.replace(/^arXiv:/i, "")}`;
    }
    return "";
  }

  function identifierLabel(identifier) {
    const value = identifier.namespace === "orcid"
      ? identifier.value.replace(/^https:\/\/orcid\.org\//, "")
      : identifier.value;
    return `${identifier.namespace.toUpperCase()}: ${value}`;
  }

  function renderIdentifiers(container, identifiers) {
    container.replaceChildren();
    container.hidden = !identifiers.length;
    for (const identifier of identifiers) {
      const href = identifierHref(identifier);
      const element = document.createElement(href ? "a" : "span");
      element.textContent = identifierLabel(identifier);
      if (href) {
        element.href = href;
        element.target = "_blank";
        element.rel = "noopener noreferrer";
      }
      container.append(element);
    }
  }

  function visibleRelations() {
    return view.relations.filter((relation) => relation.object.kind === selectedKind);
  }

  function selectedRelation() {
    return visibleRelations().find((relation) => relation.id === selectedRelationId) || null;
  }

  function renderTabs() {
    const kinds = [...new Set(view.relations.map((relation) => relation.object.kind))].sort(
      (left, right) => kindDetails(left).order - kindDetails(right).order
    );
    tabs.replaceChildren();

    for (const kind of kinds) {
      const button = document.createElement("button");
      const selected = kind === selectedKind;
      button.className = `relation-tab${selected ? " is-selected" : ""}`;
      button.type = "button";
      button.role = "tab";
      button.ariaSelected = String(selected);
      button.dataset.objectKind = kind;

      const label = document.createElement("span");
      label.textContent = kindDetails(kind).plural;
      const count = document.createElement("span");
      count.className = "relation-tab-count";
      count.textContent = String(view.relations.filter((relation) => relation.object.kind === kind).length);
      button.append(label, count);
      button.addEventListener("click", () => {
        selectedKind = kind;
        selectedRelationId = visibleRelations()[0]?.id || "";
        renderRelations();
      });
      tabs.append(button);
    }
  }

  function renderList() {
    relationList.replaceChildren();
    const relations = visibleRelations();
    if (!relations.length) {
      const empty = document.createElement("p");
      empty.className = "relation-empty";
      empty.textContent = "No indexed relations of this kind yet.";
      relationList.append(empty);
      return;
    }

    for (const relation of relations) {
      const button = document.createElement("button");
      button.className = `reason-card${relation.id === selectedRelationId ? " is-selected" : ""}`;
      button.type = "button";
      button.ariaPressed = String(relation.id === selectedRelationId);

      const title = document.createElement("span");
      title.className = "reason-card-title";
      title.textContent = relation.object.label;
      button.append(title);

      if (relation.object.description && relation.object.description !== relation.object.label) {
        const description = document.createElement("span");
        description.className = "reason-card-reason";
        description.textContent = relation.object.description;
        button.append(description);
      }

      button.addEventListener("click", () => {
        selectedRelationId = relation.id;
        renderList();
        renderDetail();
      });
      relationList.append(button);
    }
  }

  function renderDetail() {
    const relation = selectedRelation();
    if (!relation) {
      detailKind.textContent = "Relation";
      detailTitle.textContent = "Nothing indexed yet";
      detailIdentifiers.hidden = true;
      detailStatement.textContent = "This object has no indexed relations of this kind.";
      evidenceDetails.hidden = true;
      return;
    }

    detailKind.textContent = kindDetails(relation.object.kind).singular;
    detailTitle.replaceChildren();
    const link = document.createElement("a");
    link.href = objectHref(relation.object);
    link.textContent = relation.object.label;
    detailTitle.append(link);
    renderIdentifiers(detailIdentifiers, relation.object.identifiers || []);
    detailStatement.textContent = relation.statement || relation.object.description;

    const evidence = relation.evidence || [];
    evidenceDetails.hidden = false;
    evidenceSummary.textContent = evidence.length === 1 ? "1 span" : `${evidence.length} spans`;
    evidenceRows.replaceChildren();

    if (!evidence.length) {
      const row = document.createElement("tr");
      row.className = "relationship-evidence-empty";
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.textContent = "This connection is grounded in accepted metadata.";
      row.append(cell);
      evidenceRows.append(row);
      return;
    }

    for (const item of evidence) {
      const row = document.createElement("tr");
      const spanCell = document.createElement("td");
      spanCell.textContent = item.span;
      const sourceCell = document.createElement("td");
      if (item.source?.id) {
        const sourceLink = document.createElement("a");
        sourceLink.className = "evidence-source-link";
        sourceLink.href = objectHref({ ...item.source, kind: "source_document" });
        sourceLink.textContent = item.source.label;
        sourceCell.append(sourceLink);
      } else {
        sourceCell.textContent = item.source?.label || "Source text";
      }
      row.append(spanCell, sourceCell);
      evidenceRows.append(row);
    }
  }

  function renderRelations() {
    renderTabs();
    renderList();
    renderDetail();
  }

  function renderObject() {
    const object = view.object;
    const kinds = new Set(view.relations.map((relation) => relation.object.kind));
    selectedKind = [...kinds].sort(
      (left, right) => kindDetails(left).order - kindDetails(right).order
    )[0] || "";
    selectedRelationId = visibleRelations()[0]?.id || "";

    document.title = `${object.label} | Scientific index | Sina Booeshaghi`;
    breadcrumb.textContent = object.label;
    breadcrumb.title = object.label;
    kindBreadcrumb.textContent = kindDetails(object.kind).breadcrumb;
    objectKind.textContent = kindDetails(object.kind).singular;
    objectTitle.textContent = object.label;
    objectDescription.textContent = object.description;
    objectDescription.hidden = !object.description;
    renderIdentifiers(objectIdentifiers, object.identifiers || []);
    relationCount.textContent = String(view.relations.length);
    kindCount.textContent = String(kinds.size);
    renderRelations();

    status.hidden = true;
    content.hidden = false;
  }

  async function load() {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) throw new Error("No object was selected.");
    const manifestResponse = await fetch("object-data/manifest.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("The object index is unavailable.");
    const manifest = await manifestResponse.json();
    const bucket = bucketForObjectId(id, manifest.bucket_count).toString(16).padStart(2, "0");
    const bucketResponse = await fetch(`object-data/${bucket}.json`, { cache: "no-store" });
    if (!bucketResponse.ok) throw new Error("The object index is unavailable.");
    const objects = await bucketResponse.json();
    view = objects[id];
    if (!view) throw new Error("This object is not in the current index.");
    renderObject();
  }

  load().catch((error) => {
    status.classList.add("object-page-error");
    status.textContent = error.message;
  });
})();
