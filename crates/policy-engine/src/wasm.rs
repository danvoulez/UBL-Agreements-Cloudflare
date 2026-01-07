//! WASM bindings for the policy engine.

#![cfg(feature = "wasm")]

use crate::context::EvaluationContext;
use crate::decision::PolicyDecision;
use crate::evaluator::PolicyEvaluator;
use crate::policy::Policy;
use wasm_bindgen::prelude::*;

/// WASM-compatible policy engine wrapper.
#[wasm_bindgen]
pub struct WasmPolicyEngine {
    evaluator: PolicyEvaluator,
}

#[wasm_bindgen]
impl WasmPolicyEngine {
    /// Creates a new WASM policy engine.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            evaluator: PolicyEvaluator::new(),
        }
    }

    /// Loads a policy from YAML string.
    #[wasm_bindgen]
    pub fn load_policy_yaml(&mut self, yaml: &str) -> Result<(), JsValue> {
        self.evaluator
            .load_policy_yaml(yaml)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Loads a policy from JSON string.
    #[wasm_bindgen]
    pub fn load_policy_json(&mut self, json: &str) -> Result<(), JsValue> {
        let policy = Policy::from_json(json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.evaluator.add_policy(policy);
        Ok(())
    }

    /// Evaluates policies against a context (JSON string).
    /// Returns the decision as a JSON string.
    #[wasm_bindgen]
    pub fn evaluate(&self, context_json: &str) -> Result<String, JsValue> {
        let context: EvaluationContext = serde_json::from_str(context_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid context: {}", e)))?;

        let decision = self.evaluator
            .evaluate(&context)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        serde_json::to_string(&decision)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Quick evaluation that returns just allow/deny as a boolean.
    #[wasm_bindgen]
    pub fn is_allowed(&self, context_json: &str) -> Result<bool, JsValue> {
        let context: EvaluationContext = serde_json::from_str(context_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid context: {}", e)))?;

        let decision = self.evaluator
            .evaluate(&context)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(decision.is_allowed())
    }

    /// Returns the number of loaded policies.
    #[wasm_bindgen]
    pub fn policy_count(&self) -> usize {
        self.evaluator.policies.len()
    }
}

impl Default for WasmPolicyEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Canonicalizes a JSON string.
#[wasm_bindgen]
pub fn canonicalize_json(json: &str) -> Result<String, JsValue> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| JsValue::from_str(&format!("Invalid JSON: {}", e)))?;

    crate::canonicalization::canonicalize(&value)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Computes SHA-256 hash of a string.
#[wasm_bindgen]
pub fn sha256(data: &str) -> String {
    crate::hash::sha256_str(data)
}

/// Computes a CID for data.
#[wasm_bindgen]
pub fn compute_cid(data: &str) -> String {
    crate::hash::compute_cid(data)
}

/// Computes a head hash for chain linking.
#[wasm_bindgen]
pub fn compute_head_hash(prev_hash: &str, cid: &str) -> String {
    crate::hash::compute_head_hash(prev_hash, cid)
}

/// Returns the genesis hash constant.
#[wasm_bindgen]
pub fn genesis_hash() -> String {
    crate::hash::GENESIS_HASH.to_string()
}

/// Logs a message to the console (for debugging).
#[wasm_bindgen]
pub fn log(message: &str) {
    web_sys::console::log_1(&JsValue::from_str(message));
}

/// Returns the version of the policy engine.
#[wasm_bindgen]
pub fn version() -> String {
    crate::VERSION.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_engine() {
        let mut engine = WasmPolicyEngine::new();

        let policy_yaml = r#"
id: test
version: "1.0.0"
name: Test
rules:
  - id: allow-all
    effect: allow
    conditions: []
"#;

        engine.load_policy_yaml(policy_yaml).unwrap();
        assert_eq!(engine.policy_count(), 1);
    }
}
