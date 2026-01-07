//! Policy decision types.

use crate::types::Effect;
use serde::{Deserialize, Serialize};

/// The final decision from policy evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Allow,
    Deny,
}

impl From<Effect> for Decision {
    fn from(effect: Effect) -> Self {
        match effect {
            Effect::Allow => Decision::Allow,
            Effect::Deny => Decision::Deny,
        }
    }
}

/// A complete policy decision with metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    /// The final decision.
    pub decision: Decision,

    /// Reason for the decision.
    pub reason: String,

    /// ID of the rule that made the decision (if any).
    pub rule_id: Option<String>,

    /// ID of the policy that made the decision.
    pub policy_id: Option<String>,

    /// Whether this is a default decision (no matching rules).
    pub is_default: bool,

    /// Time taken to evaluate (in microseconds).
    pub evaluation_time_us: Option<u64>,

    /// Additional metadata about the decision.
    #[serde(default)]
    pub metadata: std::collections::HashMap<String, serde_json::Value>,
}

impl PolicyDecision {
    /// Creates a new allow decision.
    pub fn allow(reason: impl Into<String>) -> Self {
        Self {
            decision: Decision::Allow,
            reason: reason.into(),
            rule_id: None,
            policy_id: None,
            is_default: false,
            evaluation_time_us: None,
            metadata: std::collections::HashMap::new(),
        }
    }

    /// Creates a new deny decision.
    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            decision: Decision::Deny,
            reason: reason.into(),
            rule_id: None,
            policy_id: None,
            is_default: false,
            evaluation_time_us: None,
            metadata: std::collections::HashMap::new(),
        }
    }

    /// Creates a default allow decision.
    pub fn default_allow() -> Self {
        Self {
            decision: Decision::Allow,
            reason: "No matching rules - default allow".to_string(),
            rule_id: None,
            policy_id: None,
            is_default: true,
            evaluation_time_us: None,
            metadata: std::collections::HashMap::new(),
        }
    }

    /// Creates a default deny decision.
    pub fn default_deny() -> Self {
        Self {
            decision: Decision::Deny,
            reason: "No matching rules - default deny".to_string(),
            rule_id: None,
            policy_id: None,
            is_default: true,
            evaluation_time_us: None,
            metadata: std::collections::HashMap::new(),
        }
    }

    /// Sets the rule ID.
    pub fn with_rule_id(mut self, rule_id: impl Into<String>) -> Self {
        self.rule_id = Some(rule_id.into());
        self
    }

    /// Sets the policy ID.
    pub fn with_policy_id(mut self, policy_id: impl Into<String>) -> Self {
        self.policy_id = Some(policy_id.into());
        self
    }

    /// Sets the evaluation time.
    pub fn with_evaluation_time(mut self, time_us: u64) -> Self {
        self.evaluation_time_us = Some(time_us);
        self
    }

    /// Adds metadata.
    pub fn with_metadata(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }

    /// Returns true if the decision is allow.
    pub fn is_allowed(&self) -> bool {
        matches!(self.decision, Decision::Allow)
    }

    /// Returns true if the decision is deny.
    pub fn is_denied(&self) -> bool {
        matches!(self.decision, Decision::Deny)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allow_decision() {
        let decision = PolicyDecision::allow("Test allow");
        assert!(decision.is_allowed());
        assert!(!decision.is_denied());
    }

    #[test]
    fn test_deny_decision() {
        let decision = PolicyDecision::deny("Test deny");
        assert!(decision.is_denied());
        assert!(!decision.is_allowed());
    }

    #[test]
    fn test_default_decisions() {
        let allow = PolicyDecision::default_allow();
        assert!(allow.is_allowed());
        assert!(allow.is_default);

        let deny = PolicyDecision::default_deny();
        assert!(deny.is_denied());
        assert!(deny.is_default);
    }
}
