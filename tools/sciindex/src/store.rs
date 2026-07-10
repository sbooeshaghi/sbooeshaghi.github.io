use crate::model::{Connection, Object, ResourceIndex, Source};
use crate::relations::{relations, RelationsOptions, RelationsResult};
use crate::search::{search, SearchHit, SearchOptions};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Projection {
    Default,
    Verbose,
}

impl Projection {
    pub fn from_verbose(verbose: bool) -> Self {
        if verbose {
            Self::Verbose
        } else {
            Self::Default
        }
    }

    pub fn is_verbose(self) -> bool {
        self == Self::Verbose
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityRef {
    Object(usize),
    Connection(usize),
    Source(usize),
}

pub struct ResourceIndexStore {
    pub data: ResourceIndex,
    object_by_id: HashMap<String, usize>,
    object_by_alias: HashMap<String, Vec<usize>>,
    connection_by_id: HashMap<String, usize>,
    source_by_id: HashMap<String, usize>,
    incoming: HashMap<String, Vec<usize>>,
    outgoing: HashMap<String, Vec<usize>>,
}

impl ResourceIndexStore {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let text = fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let data: ResourceIndex = serde_json::from_str(&text)
            .with_context(|| format!("failed to parse resource index {}", path.display()))?;
        Ok(Self::new(data))
    }

    pub fn new(data: ResourceIndex) -> Self {
        let mut object_by_id = HashMap::new();
        let mut object_by_alias: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, object) in data.objects.iter().enumerate() {
            object_by_id.insert(object.id.clone(), idx);
            for alias in object_aliases(object) {
                object_by_alias.entry(alias).or_default().push(idx);
            }
        }

        let mut source_by_id = HashMap::new();
        for (idx, source) in data.sources.iter().enumerate() {
            source_by_id.insert(source.id.clone(), idx);
        }

        let mut connection_by_id = HashMap::new();
        let mut incoming: HashMap<String, Vec<usize>> = HashMap::new();
        let mut outgoing: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, connection) in data.connections.iter().enumerate() {
            connection_by_id.insert(connection.id.clone(), idx);
            incoming
                .entry(connection.target.clone())
                .or_default()
                .push(idx);
            outgoing
                .entry(connection.source.clone())
                .or_default()
                .push(idx);
        }

        Self {
            data,
            object_by_id,
            object_by_alias,
            connection_by_id,
            source_by_id,
            incoming,
            outgoing,
        }
    }

    pub fn search(&self, query: &str, options: SearchOptions) -> Vec<SearchHit> {
        search(self, query, options)
    }

    pub fn fetch(&self, query: &str) -> Result<Option<Value>> {
        self.fetch_with_projection(query, Projection::Default)
    }

    pub fn fetch_with_projection(
        &self,
        query: &str,
        projection: Projection,
    ) -> Result<Option<Value>> {
        let Some(entity) = self.resolve(query)? else {
            return Ok(None);
        };
        Ok(Some(match entity {
            EntityRef::Object(idx) => self.fetch_object(idx, projection),
            EntityRef::Connection(idx) => self.fetch_connection(idx, projection),
            EntityRef::Source(idx) => self.fetch_source(idx, projection),
        }))
    }

    pub fn relations(
        &self,
        query: &str,
        options: RelationsOptions,
    ) -> Result<Option<RelationsResult>> {
        relations(self, query, options)
    }

    pub fn resolve(&self, query: &str) -> Result<Option<EntityRef>> {
        let raw = query.trim();
        if raw.is_empty() {
            return Ok(None);
        }

        if let Some(idx) = self.object_by_id.get(raw) {
            return Ok(Some(EntityRef::Object(*idx)));
        }
        if let Some(idx) = self.connection_by_id.get(raw) {
            return Ok(Some(EntityRef::Connection(*idx)));
        }
        if let Some(idx) = self.source_by_id.get(raw) {
            return Ok(Some(EntityRef::Source(*idx)));
        }

        let mut candidates = Vec::new();
        for alias in query_aliases(raw) {
            if let Some(indices) = self.object_by_alias.get(&alias) {
                candidates.extend(indices.iter().copied());
            }
        }
        candidates.sort_unstable();
        candidates.dedup();

        match candidates.as_slice() {
            [] => Ok(None),
            [idx] => Ok(Some(EntityRef::Object(*idx))),
            _ => {
                let mut ids = candidates
                    .iter()
                    .map(|idx| self.data.objects[*idx].id.as_str())
                    .collect::<Vec<_>>();
                ids.sort_unstable();
                bail!(
                    "ambiguous object identifier {raw:?}; candidate object IDs: {}",
                    ids.join(", ")
                )
            }
        }
    }

    pub fn object(&self, idx: usize) -> Option<&Object> {
        self.data.objects.get(idx)
    }

    pub fn connection(&self, idx: usize) -> Option<&Connection> {
        self.data.connections.get(idx)
    }

    pub fn source(&self, idx: usize) -> Option<&Source> {
        self.data.sources.get(idx)
    }

    pub fn object_by_id(&self, id: &str) -> Option<&Object> {
        self.object_by_id.get(id).and_then(|idx| self.object(*idx))
    }

    pub fn incoming_connections(&self, object_id: &str) -> &[usize] {
        self.incoming
            .get(object_id)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub fn outgoing_connections(&self, object_id: &str) -> &[usize] {
        self.outgoing
            .get(object_id)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub fn connected_counts(&self, object_id: &str) -> Value {
        let incoming = self.incoming_connections(object_id);
        let outgoing = self.outgoing_connections(object_id);
        json!({
            "incoming": incoming.len(),
            "outgoing": outgoing.len(),
            "grounded_incoming": incoming.iter().filter(|idx| connection_is_grounded(&self.data.connections[**idx])).count(),
            "grounded_outgoing": outgoing.iter().filter(|idx| connection_is_grounded(&self.data.connections[**idx])).count()
        })
    }

    pub fn compact_object(&self, object_id: &str) -> Value {
        match self.object_by_id(object_id) {
            Some(object) => json!({
                "id": object.id,
                "kind": object.kind,
                "label": object.label,
                "description": object.description
            }),
            None => json!({
                "id": object_id,
                "kind": "",
                "label": "",
                "description": ""
            }),
        }
    }

    fn fetch_object(&self, idx: usize, projection: Projection) -> Value {
        let object = &self.data.objects[idx];
        if projection.is_verbose() {
            return json!({
                "id": object.id,
                "kind": object.kind,
                "label": object.label,
                "description": object.description,
                "properties": object.properties,
                "connection_counts": self.connected_counts(&object.id)
            });
        }

        let mut value = json!({
            "id": object.id,
            "kind": object.kind,
            "label": object.label,
            "description": object.description,
            "connection_counts": self.connected_counts(&object.id)
        });
        add_optional_field(
            &mut value,
            "identifiers",
            compact_identifiers(&object.properties),
        );
        value
    }

    fn fetch_connection(&self, idx: usize, projection: Projection) -> Value {
        let connection = &self.data.connections[idx];
        let mut value = json!({
            "id": connection.id,
            "kind": "connection",
            "source": self.compact_object(&connection.source),
            "target": self.compact_object(&connection.target),
            "statement": connection.statement,
            "grounded": connection_is_grounded(connection),
            "evidence_count": connection.evidence.len()
        });
        if projection.is_verbose() {
            value["evidence"] = json!(connection.evidence);
            value["properties"] = connection.properties.clone();
        }
        value
    }

    fn fetch_source(&self, idx: usize, projection: Projection) -> Value {
        let source = &self.data.sources[idx];
        let mut value = json!({
            "id": source.id,
            "kind": source.kind,
            "label": source.label,
            "description": source.locator,
            "locator": source.locator
        });
        if projection.is_verbose() {
            value["properties"] = source.properties.clone();
        }
        value
    }
}

fn add_optional_field(record: &mut Value, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        record[key] = value;
    }
}

pub(crate) fn compact_identifiers(properties: &Value) -> Option<Value> {
    if let Some(identifiers) = properties.get("identifiers").and_then(Value::as_array) {
        if !identifiers.is_empty() {
            return Some(Value::Array(identifiers.clone()));
        }
    }

    let mut identifiers = Vec::new();
    for key in ["doi", "url"] {
        if let Some(value) = properties.get(key).and_then(Value::as_str) {
            identifiers.push(json!({
                "kind": key,
                "value": value
            }));
        }
    }

    (!identifiers.is_empty()).then_some(Value::Array(identifiers))
}

pub fn connection_is_grounded(connection: &Connection) -> bool {
    if !connection.evidence.is_empty() {
        return true;
    }
    connection
        .properties
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| status == "grounded")
}

pub fn normalize_doi(value: &str) -> String {
    let mut text = value.trim().to_lowercase();
    if let Some(rest) = text.strip_prefix("https://doi.org/") {
        text = rest.to_string();
    } else if let Some(rest) = text.strip_prefix("http://doi.org/") {
        text = rest.to_string();
    } else if let Some(rest) = text.strip_prefix("doi:") {
        text = rest.trim().to_string();
    }

    if let Some(start) = text.find("10.") {
        text = text[start..].to_string();
    }

    text.trim_end_matches('/')
        .trim_end_matches(".abstract")
        .trim_end_matches(".full")
        .trim_end_matches(".full.pdf")
        .to_string()
}

pub fn normalize_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_lowercase()
}

fn object_aliases(object: &Object) -> Vec<String> {
    let mut aliases = vec![object.id.clone(), object.label.to_lowercase()];
    if let Some(rest) = object.id.strip_prefix("work:") {
        aliases.push(rest.to_string());
    }
    if let Some(rest) = object.id.strip_prefix("version:") {
        aliases.push(rest.to_string());
    }
    if let Some(rest) = object.id.strip_prefix("document:") {
        aliases.push(rest.to_string());
    }

    add_string_property(&mut aliases, &object.properties, "slug");
    add_string_property(&mut aliases, &object.properties, "doi");
    add_string_property(&mut aliases, &object.properties, "url");
    add_string_property(&mut aliases, &object.properties, "pdf_path");
    add_string_property(&mut aliases, &object.properties, "text_path");

    if let Some(identifiers) = object
        .properties
        .get("identifiers")
        .and_then(Value::as_array)
    {
        for identifier in identifiers {
            if let Some(value) = identifier.get("value").and_then(Value::as_str) {
                aliases.push(value.to_string());
            }
        }
    }
    if let Some(extra_aliases) = object.properties.get("aliases").and_then(Value::as_array) {
        for alias in extra_aliases {
            if let Some(value) = alias.as_str() {
                aliases.push(value.to_string());
            }
        }
    }

    aliases
        .into_iter()
        .flat_map(|alias| query_aliases(&alias))
        .filter(|alias| !alias.is_empty())
        .collect()
}

fn add_string_property(aliases: &mut Vec<String>, properties: &Value, key: &str) {
    if let Some(value) = properties.get(key).and_then(Value::as_str) {
        aliases.push(value.to_string());
    }
}

fn query_aliases(raw: &str) -> Vec<String> {
    let mut aliases = Vec::new();
    let trimmed = raw.trim();
    aliases.push(trimmed.to_string());
    aliases.push(trimmed.to_lowercase());
    if let Some(rest) = trimmed.strip_prefix("work:") {
        aliases.push(rest.to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("version:") {
        aliases.push(rest.to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("document:") {
        aliases.push(rest.to_string());
    }
    let doi = normalize_doi(trimmed);
    if !doi.is_empty() {
        aliases.push(doi);
    }
    let url = normalize_url(trimmed);
    if !url.is_empty() {
        aliases.push(url);
    }
    aliases.sort();
    aliases.dedup();
    aliases
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_store() -> ResourceIndexStore {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../db/resource-index.json");
        ResourceIndexStore::load(path).expect("load resource index fixture")
    }

    fn ambiguous_store() -> ResourceIndexStore {
        ResourceIndexStore::new(ResourceIndex {
            schema_version: String::new(),
            generated_at: String::new(),
            description: String::new(),
            objects: vec![
                Object {
                    id: "work:first".to_string(),
                    kind: "publication".to_string(),
                    label: "First".to_string(),
                    description: String::new(),
                    properties: json!({
                        "identifiers": [{"kind": "doi", "value": "10.1234/shared"}]
                    }),
                },
                Object {
                    id: "work:second".to_string(),
                    kind: "publication".to_string(),
                    label: "Second".to_string(),
                    description: String::new(),
                    properties: json!({
                        "identifiers": [{"kind": "doi", "value": "10.1234/shared"}],
                        "aliases": ["work:first"]
                    }),
                },
            ],
            connections: Vec::new(),
            sources: Vec::new(),
        })
    }

    #[test]
    fn loads_index_as_generic_objects() {
        let store = fixture_store();
        assert!(store.data.objects.len() > 30);
        assert!(store.data.connections.len() > 100);
    }

    #[test]
    fn resolves_work_slug() {
        let store = fixture_store();
        let resolved = store
            .resolve("modular-efficient-and-constant-memory-single-cell-rna-seq-preprocessing")
            .expect("resolve work slug");
        assert!(matches!(resolved, Some(EntityRef::Object(_))));
    }

    #[test]
    fn resolves_doi() {
        let store = fixture_store();
        let resolved = store
            .resolve("10.1038/s41587-021-00870-2")
            .expect("resolve DOI");
        assert!(matches!(resolved, Some(EntityRef::Object(_))));
    }

    #[test]
    fn fetch_rejects_ambiguous_object_identifier() {
        let error = ambiguous_store()
            .fetch("https://doi.org/10.1234/shared")
            .expect_err("shared DOI must be ambiguous");
        let message = error.to_string();
        assert!(message.contains("ambiguous object identifier"));
        assert!(message.contains("work:first"));
        assert!(message.contains("work:second"));
    }

    #[test]
    fn relations_reject_ambiguous_object_identifier() {
        let error = ambiguous_store()
            .relations("10.1234/shared", RelationsOptions::default())
            .expect_err("shared DOI must be ambiguous");
        let message = error.to_string();
        assert!(message.contains("work:first"));
        assert!(message.contains("work:second"));
    }

    #[test]
    fn exact_object_id_wins_over_colliding_alias() {
        let fetched = ambiguous_store()
            .fetch("work:first")
            .expect("resolve exact object ID")
            .expect("fetch exact object ID");
        assert_eq!(
            fetched.get("id").and_then(Value::as_str),
            Some("work:first")
        );
    }

    #[test]
    fn searches_for_kallisto() {
        let store = fixture_store();
        let hits = store.search(
            "kallisto barcode",
            SearchOptions {
                limit: 5,
                kind: None,
            },
        );
        assert!(!hits.is_empty());
        assert!(hits
            .iter()
            .any(|hit| hit.kind == "publication" || hit.kind == "connection"));
    }

    #[test]
    fn fetch_defaults_to_compact_projection() {
        let store = fixture_store();
        let compact = store
            .fetch("10.1038/s41587-021-00870-2")
            .expect("resolve publication")
            .expect("fetch publication");
        assert_eq!(
            compact.get("kind").and_then(Value::as_str),
            Some("publication")
        );
        assert!(compact.get("connection_counts").is_some());
        assert!(compact.get("properties").is_none());

        let verbose = store
            .fetch_with_projection("10.1038/s41587-021-00870-2", Projection::Verbose)
            .expect("resolve publication")
            .expect("fetch publication");
        assert!(verbose.get("properties").is_some());
    }
}
