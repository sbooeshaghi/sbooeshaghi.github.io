use crate::model::Evidence;
use crate::store::{
    compact_identifiers, connection_is_grounded, EntityRef, Projection, ResourceIndexStore,
};
use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum Direction {
    Incoming,
    Outgoing,
    Both,
}

#[derive(Debug, Clone)]
pub struct RelationsOptions {
    pub direction: Direction,
    pub depth: usize,
    pub grounded_only: bool,
    pub include_evidence: bool,
    pub projection: Projection,
    pub limit: usize,
}

impl Default for RelationsOptions {
    fn default() -> Self {
        Self {
            direction: Direction::Both,
            depth: 1,
            grounded_only: false,
            include_evidence: false,
            projection: Projection::Default,
            limit: 50,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RelationsResult {
    pub root: RelatedObject,
    pub direction: String,
    pub depth: usize,
    pub total_count: usize,
    pub returned_count: usize,
    pub truncated: bool,
    pub connections: Vec<RelatedConnection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelatedObject {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifiers: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelatedConnection {
    pub id: String,
    pub source: RelatedObject,
    pub target: RelatedObject,
    pub statement: String,
    pub evidence_count: usize,
    pub grounded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Vec<Evidence>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<Value>,
}

pub fn relations(
    store: &ResourceIndexStore,
    query: &str,
    options: RelationsOptions,
) -> Result<Option<RelationsResult>> {
    let Some(root_ref) = store.resolve(query)? else {
        return Ok(None);
    };
    let Some(root_id) = object_id_for_ref(store, root_ref) else {
        return Ok(None);
    };
    let root = node_for_object(store, &root_id, options.projection);
    let max_depth = options.depth.max(1);

    let mut all_edges = Vec::new();
    let mut seen_edges = HashSet::new();
    let mut seen_objects = HashSet::new();
    let mut frontier = VecDeque::from([(root_id.clone(), 0usize)]);
    seen_objects.insert(root_id);

    while let Some((object_id, depth)) = frontier.pop_front() {
        if depth >= max_depth {
            continue;
        }

        let edge_indices = match options.direction {
            Direction::Incoming => store.incoming_connections(&object_id).to_vec(),
            Direction::Outgoing => store.outgoing_connections(&object_id).to_vec(),
            Direction::Both => store
                .incoming_connections(&object_id)
                .iter()
                .chain(store.outgoing_connections(&object_id))
                .copied()
                .collect(),
        };

        for edge_idx in edge_indices {
            let Some(connection) = store.connection(edge_idx) else {
                continue;
            };
            if options.grounded_only && !connection_is_grounded(connection) {
                continue;
            }
            if !seen_edges.insert(connection.id.clone()) {
                continue;
            }

            let next_object = if connection.source == object_id {
                connection.target.clone()
            } else {
                connection.source.clone()
            };
            if seen_objects.insert(next_object.clone()) {
                frontier.push_back((next_object, depth + 1));
            }
            all_edges.push(edge_idx);
        }
    }

    let total_count = all_edges.len();
    let connections = all_edges
        .into_iter()
        .take(options.limit)
        .filter_map(|idx| {
            let connection = store.connection(idx)?;
            let grounded = connection_is_grounded(connection);
            Some(RelatedConnection {
                id: connection.id.clone(),
                source: node_for_object(store, &connection.source, options.projection),
                target: node_for_object(store, &connection.target, options.projection),
                statement: connection.statement.clone(),
                evidence_count: connection.evidence.len(),
                grounded,
                evidence: (options.include_evidence || options.projection.is_verbose())
                    .then(|| connection.evidence.clone()),
                properties: options
                    .projection
                    .is_verbose()
                    .then(|| connection.properties.clone()),
            })
        })
        .collect::<Vec<_>>();

    Ok(Some(RelationsResult {
        root,
        direction: format!("{:?}", options.direction).to_lowercase(),
        depth: max_depth,
        total_count,
        returned_count: connections.len(),
        truncated: total_count > connections.len(),
        connections,
    }))
}

fn object_id_for_ref(store: &ResourceIndexStore, entity: EntityRef) -> Option<String> {
    match entity {
        EntityRef::Object(idx) => store.object(idx).map(|object| object.id.clone()),
        EntityRef::Connection(idx) => store
            .connection(idx)
            .map(|connection| connection.target.clone()),
        EntityRef::Source(idx) => store.source(idx).and_then(|source| {
            source
                .properties
                .get("document_id")
                .and_then(|id| id.as_str())
                .map(str::to_string)
        }),
    }
}

fn node_for_object(
    store: &ResourceIndexStore,
    object_id: &str,
    projection: Projection,
) -> RelatedObject {
    match store.object_by_id(object_id) {
        Some(object) => RelatedObject {
            id: object.id.clone(),
            kind: object.kind.clone(),
            label: object.label.clone(),
            description: object.description.clone(),
            identifiers: projection
                .is_verbose()
                .then(|| compact_identifiers(&object.properties))
                .flatten(),
        },
        None => RelatedObject {
            id: object_id.to_string(),
            kind: String::new(),
            label: String::new(),
            description: String::new(),
            identifiers: None,
        },
    }
}
