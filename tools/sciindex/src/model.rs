use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourceIndex {
    #[serde(default)]
    pub schema_version: String,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub objects: Vec<Object>,
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Object {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub properties: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Connection {
    pub id: String,
    pub source: String,
    pub target: String,
    pub statement: String,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub properties: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Source {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub locator: String,
    #[serde(default)]
    pub properties: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Evidence {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub span: String,
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub properties: Value,
}
