//! NEP-297 events. Indexers and the web app read these from receipt logs.
use near_sdk::{env, serde_json::{self, Value}};

pub const STANDARD: &str = "tally";
pub const VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: Value) {
    let body = serde_json::json!({
        "standard": STANDARD,
        "version": VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{body}"));
}
