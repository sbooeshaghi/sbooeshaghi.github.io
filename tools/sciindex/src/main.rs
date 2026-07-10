use anyhow::Result;
use clap::{Parser, Subcommand};
use sciindex::{Direction, Projection, RelationsOptions, ResourceIndexStore, SearchOptions};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Parser)]
#[command(version, about = "Query a small object/connection/source index")]
struct Cli {
    #[arg(long, default_value = "db/resource-index.json", global = true)]
    index: PathBuf,

    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Search objects, connections, and sources.
    Search {
        query: String,
        #[arg(short, long, default_value_t = 10)]
        limit: usize,
        #[arg(long)]
        kind: Option<String>,
    },
    /// Fetch an object, connection, or source by id, alias, DOI, or URL.
    Fetch {
        id: String,
        #[arg(long)]
        verbose: bool,
    },
    /// Traverse incoming and outgoing connections.
    Relations {
        id: String,
        #[arg(long, value_enum, default_value_t = Direction::Both)]
        direction: Direction,
        #[arg(long, default_value_t = 1)]
        depth: usize,
        #[arg(long)]
        grounded: bool,
        #[arg(long)]
        include_evidence: bool,
        #[arg(long)]
        verbose: bool,
        #[arg(short, long, default_value_t = 50)]
        limit: usize,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let store = ResourceIndexStore::load(&cli.index)?;

    match cli.command {
        Command::Search { query, limit, kind } => {
            let result = store.search(&query, SearchOptions { limit, kind });
            if cli.json {
                print_json(&result)?;
            } else {
                for hit in result {
                    println!("{:.1}\t{}\t{}\t{}", hit.score, hit.kind, hit.id, hit.label);
                    if !hit.snippet.is_empty() {
                        println!("  {}", hit.snippet);
                    }
                }
            }
        }
        Command::Fetch { id, verbose } => {
            let Some(result) =
                store.fetch_with_projection(&id, Projection::from_verbose(verbose))?
            else {
                anyhow::bail!("no entity resolved for {id}");
            };
            if cli.json {
                print_json(&result)?;
            } else {
                print_fetch_human(&result);
            }
        }
        Command::Relations {
            id,
            direction,
            depth,
            grounded,
            include_evidence,
            verbose,
            limit,
        } => {
            let Some(result) = store.relations(
                &id,
                RelationsOptions {
                    direction,
                    depth,
                    grounded_only: grounded,
                    include_evidence,
                    projection: Projection::from_verbose(verbose),
                    limit,
                },
            )?
            else {
                anyhow::bail!("no relation root resolved for {id}");
            };
            if cli.json {
                print_json(&result)?;
            } else {
                println!("root\t{}\t{}", result.root.id, result.root.label);
                println!(
                    "connections\treturned={}\ttotal={}\ttruncated={}",
                    result.returned_count, result.total_count, result.truncated
                );
                for connection in result.connections {
                    println!(
                        "{}\t{}\t{}\t{}",
                        if connection.grounded {
                            "grounded"
                        } else {
                            "known"
                        },
                        connection.source.label,
                        connection.target.label,
                        connection.statement
                    );
                }
            }
        }
    }

    Ok(())
}

fn print_json(value: &impl Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn print_fetch_human(value: &serde_json::Value) {
    let kind = value.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let label = value.get("label").and_then(|v| v.as_str()).unwrap_or("");
    println!("{kind}\t{id}\t{label}");

    if let Some(description) = value.get("description").and_then(|v| v.as_str()) {
        if !description.is_empty() {
            println!("{description}");
        }
    }
}
