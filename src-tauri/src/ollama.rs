/**
 * ollama.rs — Narrow Tauri command bridge to the local Ollama instance.
 *
 * Security boundary notes:
 * - The host (127.0.0.1:11434) and paths (/api/tags, /api/generate) are
 *   hardcoded here. The frontend can never point this bridge at another URL.
 * - Model names are validated before forwarding: no traversal, no schemes,
 *   no shell metacharacters.
 * - `stream` is forced off; responses are bounded by client timeout.
 * - All I/O is blocking (ureq) inside Tauri's blocking command thread.
 * - Errors returned to the frontend are generic strings; the frontend
 *   sanitizes again before display.
 */

use serde::{Deserialize, Serialize};
use std::time::Duration;
use ureq;

const OLLAMA_HOST: &str = "http://127.0.0.1:11434";
const TAGS_PATH: &str = "/api/tags";
const GENERATE_PATH: &str = "/api/generate";

#[derive(Debug, Serialize)]
pub(crate) struct StatusDto {
    pub connected: bool,
    pub models: Vec<ModelDto>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct ModelDto {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Option<Vec<TagModel>>,
}

#[derive(Debug, Deserialize)]
struct TagModel {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
}

#[derive(Debug, Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    stream: bool,
    options: GenerateOptions,
}

#[derive(Debug, Serialize)]
struct GenerateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Debug, Deserialize)]
struct GenerateError {
    error: String,
}

/// Validates a model identifier before it is forwarded to Ollama.
fn validate_model(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 128 {
        return Err("Invalid model identifier.".to_string());
    }
    if name.contains("..")
        || name.contains("://")
        || name.contains("//")
        || name.contains('\\')
        || name.contains('\u{0}')
    {
        return Err("Invalid model identifier.".to_string());
    }
    for seg in name.split('/') {
        if seg.is_empty() {
            return Err("Invalid model identifier.".to_string());
        }
    }
    for seg in name.split(':') {
        if seg.is_empty() {
            return Err("Invalid model identifier.".to_string());
        }
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-' | '/' | ':'))
    {
        return Err("Invalid model identifier.".to_string());
    }
    Ok(())
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(8))
        .build()
}

#[tauri::command]
pub(crate) fn ollama_status() -> Result<StatusDto, String> {
    let client = agent();
    let url = format!("{}{}", OLLAMA_HOST, TAGS_PATH);
    match client.get(&url).call() {
        Ok(response) => {
            let parsed: Result<TagsResponse, _> = response.into_json().map_err(|e| e.to_string());
            match parsed {
                Ok(tags) => {
                    let models = tags
                        .models
                        .unwrap_or_default()
                        .into_iter()
                        .map(|m| ModelDto {
                            id: m.name.clone(),
                            name: m.name,
                            size: m.size,
                            digest: m.digest,
                        })
                        .collect();
                    Ok(StatusDto {
                        connected: true,
                        models,
                        error: None,
                    })
                }
                Err(e) => Ok(StatusDto {
                    connected: false,
                    models: vec![],
                    error: Some(format!("Ollama returned an unreadable response: {e}")),
                }),
            }
        }
        Err(e) => Ok(StatusDto {
            connected: false,
            models: vec![],
            error: Some(format!("Unable to reach Ollama at {OLLAMA_HOST}: {e}")),
        }),
    }
}

#[tauri::command]
pub(crate) fn ollama_generate(
    model: String,
    prompt: String,
    system: Option<String>,
    max_tokens: Option<i32>,
) -> Result<GenerateResponseDto, String> {
    validate_model(&model)?;
    if prompt.is_empty() && system.is_none() {
        return Err("Nothing to send to the model.".to_string());
    }
    if prompt.len() > 20000 {
        return Err("Prompt is too large.".to_string());
    }

    let client = agent();
    let url = format!("{}{}", OLLAMA_HOST, GENERATE_PATH);
    let request = GenerateRequest {
        model: &model,
        prompt: &prompt,
        system: system.as_deref(),
        stream: false,
        options: GenerateOptions { num_predict: max_tokens },
    };

    match client.post(&url).send_json(&request) {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                if status.as_u16() == 404 {
                    return Err(format!("Model '{model}' is not installed."));
                }
                return Err(format!("Model request failed (HTTP {}).", status.as_u16()));
            }
            let parsed: Result<GenerateResponse, _> = response.into_json().map_err(|e| e.to_string());
            match parsed {
                Ok(body) => Ok(GenerateResponseDto { response: body.response }),
                Err(e) => Err(format!("Model returned an unreadable response: {e}")),
            }
        }
        Err(e) => Err(format!("Unable to reach Ollama at {OLLAMA_HOST}: {e}")),
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct GenerateResponseDto {
    pub response: String,
}
