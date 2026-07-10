use crate::store::ResourceIndexStore;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub limit: usize,
    pub kind: Option<String>,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            limit: 10,
            kind: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    pub score: f64,
    pub snippet: String,
    pub matched_fields: Vec<String>,
}

pub fn search(store: &ResourceIndexStore, query: &str, options: SearchOptions) -> Vec<SearchHit> {
    let tokens = tokenize(query);
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut hits = Vec::new();
    search_objects(store, &tokens, &options, &mut hits);
    search_connections(store, &tokens, &options, &mut hits);
    search_sources(store, &tokens, &options, &mut hits);

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.label.cmp(&b.label))
    });
    hits.truncate(options.limit);
    hits
}

fn search_objects(
    store: &ResourceIndexStore,
    tokens: &[String],
    options: &SearchOptions,
    hits: &mut Vec<SearchHit>,
) {
    for object in &store.data.objects {
        if !kind_matches(options, &object.kind) {
            continue;
        }
        let mut score = 0.0;
        let mut fields = BTreeSet::new();
        score += score_field(tokens, &object.id, 20.0, "id", &mut fields);
        score += score_field(tokens, &object.kind, 4.0, "kind", &mut fields);
        score += score_field(tokens, &object.label, 10.0, "label", &mut fields);
        score += score_field(tokens, &object.description, 4.0, "description", &mut fields);
        score += score_properties(tokens, &object.properties, 1.0, "properties", &mut fields);

        if object.properties.get("collection").and_then(Value::as_str) == Some("my_work") {
            score *= 1.15;
        }

        if score > 0.0 {
            hits.push(SearchHit {
                id: object.id.clone(),
                kind: object.kind.clone(),
                label: object.label.clone(),
                description: object.description.clone(),
                score,
                snippet: snippet(&object.description, tokens),
                matched_fields: fields.into_iter().map(String::from).collect(),
            });
        }
    }
}

fn search_connections(
    store: &ResourceIndexStore,
    tokens: &[String],
    options: &SearchOptions,
    hits: &mut Vec<SearchHit>,
) {
    if !kind_matches(options, "connection") {
        return;
    }
    for connection in &store.data.connections {
        let mut score = 0.0;
        let mut fields = BTreeSet::new();
        score += score_field(tokens, &connection.id, 20.0, "id", &mut fields);
        score += score_field(tokens, &connection.statement, 7.0, "statement", &mut fields);
        score += score_properties(
            tokens,
            &connection.properties,
            1.5,
            "properties",
            &mut fields,
        );
        for evidence in &connection.evidence {
            score += score_field(tokens, &evidence.span, 1.0, "evidence", &mut fields);
        }

        let source = store.object_by_id(&connection.source);
        let target = store.object_by_id(&connection.target);
        let source_label = source.map(|object| object.label.as_str()).unwrap_or("");
        let target_label = target.map(|object| object.label.as_str()).unwrap_or("");
        score += score_field(tokens, source_label, 3.0, "source", &mut fields);
        score += score_field(tokens, target_label, 3.0, "target", &mut fields);

        if score > 0.0 {
            hits.push(SearchHit {
                id: connection.id.clone(),
                kind: "connection".to_string(),
                label: format!("{source_label} -> {target_label}"),
                description: connection.statement.clone(),
                score,
                snippet: snippet(&connection.statement, tokens),
                matched_fields: fields.into_iter().map(String::from).collect(),
            });
        }
    }
}

fn search_sources(
    store: &ResourceIndexStore,
    tokens: &[String],
    options: &SearchOptions,
    hits: &mut Vec<SearchHit>,
) {
    if !kind_matches(options, "source") {
        return;
    }
    for source in &store.data.sources {
        let mut score = 0.0;
        let mut fields = BTreeSet::new();
        score += score_field(tokens, &source.id, 20.0, "id", &mut fields);
        score += score_field(tokens, &source.kind, 4.0, "kind", &mut fields);
        score += score_field(tokens, &source.label, 8.0, "label", &mut fields);
        score += score_field(tokens, &source.locator, 4.0, "locator", &mut fields);
        score += score_properties(tokens, &source.properties, 1.0, "properties", &mut fields);

        if score > 0.0 {
            hits.push(SearchHit {
                id: source.id.clone(),
                kind: "source".to_string(),
                label: source.label.clone(),
                description: source.locator.clone(),
                score,
                snippet: snippet(&source.locator, tokens),
                matched_fields: fields.into_iter().map(String::from).collect(),
            });
        }
    }
}

fn kind_matches(options: &SearchOptions, kind: &str) -> bool {
    options
        .kind
        .as_deref()
        .is_none_or(|selected| selected == kind)
}

fn score_properties<'a>(
    tokens: &[String],
    properties: &Value,
    weight: f64,
    field: &'a str,
    fields: &mut BTreeSet<&'a str>,
) -> f64 {
    match properties {
        Value::Null | Value::Bool(_) | Value::Number(_) => 0.0,
        Value::String(text) => score_field(tokens, text, weight, field, fields),
        Value::Array(items) => items
            .iter()
            .map(|item| score_properties(tokens, item, weight, field, fields))
            .sum(),
        Value::Object(map) => map
            .values()
            .map(|value| score_properties(tokens, value, weight, field, fields))
            .sum(),
    }
}

fn score_field<'a>(
    query_tokens: &[String],
    text: &str,
    weight: f64,
    field: &'a str,
    fields: &mut BTreeSet<&'a str>,
) -> f64 {
    if text.is_empty() {
        return 0.0;
    }
    let text_lower = text.to_lowercase();
    let mut score = 0.0;
    for token in query_tokens {
        if text_lower.contains(token) {
            score += weight;
            fields.insert(field);
        }
    }
    score
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| token.len() > 1)
        .map(str::to_string)
        .collect()
}

fn snippet(text: &str, tokens: &[String]) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_lowercase();
    let match_start = tokens
        .iter()
        .filter_map(|token| lower.find(token))
        .min()
        .unwrap_or(0);
    let total_chars = trimmed.chars().count();
    let start = original_char_offset(trimmed, match_start).saturating_sub(48);
    let end = (start + 220).min(total_chars);
    let mut snippet = trimmed
        .chars()
        .skip(start)
        .take(end - start)
        .collect::<String>()
        .replace('\n', " ");
    if start > 0 {
        snippet.insert_str(0, "...");
    }
    if end < total_chars {
        snippet.push_str("...");
    }
    snippet
}

fn original_char_offset(text: &str, lowercase_byte_offset: usize) -> usize {
    let mut lowercase_bytes = 0;
    for (char_offset, ch) in text.chars().enumerate() {
        let next_lowercase_bytes = lowercase_bytes
            + ch.to_lowercase()
                .map(|lowercase_char| lowercase_char.len_utf8())
                .sum::<usize>();
        if lowercase_byte_offset < next_lowercase_bytes {
            return char_offset;
        }
        lowercase_bytes = next_lowercase_bytes;
    }
    text.chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_handles_multibyte_context() {
        let text = format!("{} needle {}", "é".repeat(60), "界".repeat(300));
        let result = snippet(&text, &["needle".to_string()]);

        assert!(result.starts_with("..."));
        assert!(result.contains("needle"));
        assert!(result.ends_with("..."));
    }

    #[test]
    fn snippet_maps_lowercase_expansion_to_original_text() {
        let text = format!("{} needle", "İ".repeat(300));
        let result = snippet(&text, &["needle".to_string()]);

        assert!(result.contains("needle"));
    }
}
