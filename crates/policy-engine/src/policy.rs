//! Policy definition and management.

use crate::error::{PolicyError, Result};
use crate::types::{CombiningAlgorithm, Effect, Rule};
use serde::{Deserialize, Serialize};

/// A complete policy definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    /// Unique identifier for the policy.
    pub id: String,

    /// Version of the policy.
    pub version: String,

    /// Human-readable name.
    pub name: String,

    /// Description of what this policy does.
    #[serde(default)]
    pub description: Option<String>,

    /// The rules in this policy.
    pub rules: Vec<Rule>,

    /// Algorithm for combining multiple rule results.
    #[serde(default)]
    pub combining_algorithm: CombiningAlgorithm,

    /// Default effect when no rules match.
    #[serde(default = "default_effect")]
    pub default_effect: Effect,

    /// Policy metadata.
    #[serde(default)]
    pub metadata: std::collections::HashMap<String, serde_json::Value>,
}

fn default_effect() -> Effect {
    Effect::Deny
}

impl Policy {
    /// Creates a new policy.
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            version: "1.0.0".to_string(),
            name: name.into(),
            description: None,
            rules: Vec::new(),
            combining_algorithm: CombiningAlgorithm::default(),
            default_effect: Effect::Deny,
            metadata: std::collections::HashMap::new(),
        }
    }

    /// Adds a rule to the policy.
    pub fn with_rule(mut self, rule: Rule) -> Self {
        self.rules.push(rule);
        self
    }

    /// Sets the combining algorithm.
    pub fn with_combining_algorithm(mut self, algorithm: CombiningAlgorithm) -> Self {
        self.combining_algorithm = algorithm;
        self
    }

    /// Sets the default effect.
    pub fn with_default_effect(mut self, effect: Effect) -> Self {
        self.default_effect = effect;
        self
    }

    /// Parses a policy from YAML.
    pub fn from_yaml(yaml: &str) -> Result<Self> {
        let policy: Policy = serde_yaml::from_str(yaml)?;
        policy.validate()?;
        Ok(policy)
    }

    /// Parses a policy from JSON.
    pub fn from_json(json: &str) -> Result<Self> {
        let policy: Policy = serde_json::from_str(json)?;
        policy.validate()?;
        Ok(policy)
    }

    /// Serializes the policy to YAML.
    pub fn to_yaml(&self) -> Result<String> {
        serde_yaml::to_string(self).map_err(|e| PolicyError::SerializationError(e.to_string()))
    }

    /// Serializes the policy to JSON.
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(|e| PolicyError::SerializationError(e.to_string()))
    }

    /// Validates the policy.
    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty() {
            return Err(PolicyError::ValidationError("Policy ID is required".to_string()));
        }

        if self.name.is_empty() {
            return Err(PolicyError::ValidationError("Policy name is required".to_string()));
        }

        // Validate each rule
        for rule in &self.rules {
            if rule.id.is_empty() {
                return Err(PolicyError::ValidationError("Rule ID is required".to_string()));
            }

            // Validate conditions
            for condition in &rule.conditions {
                if condition.field.is_empty() {
                    return Err(PolicyError::ValidationError(
                        format!("Condition field is required in rule '{}'", rule.id)
                    ));
                }
            }
        }

        Ok(())
    }

    /// Returns rules sorted by priority (higher priority first).
    pub fn sorted_rules(&self) -> Vec<&Rule> {
        let mut rules: Vec<&Rule> = self.rules.iter().collect();
        rules.sort_by(|a, b| b.priority.cmp(&a.priority));
        rules
    }
}

/// Builder for creating rules.
#[derive(Debug, Default)]
pub struct RuleBuilder {
    id: String,
    description: Option<String>,
    effect: Effect,
    conditions: Vec<crate::types::Condition>,
    priority: i32,
}

impl RuleBuilder {
    /// Creates a new rule builder.
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            description: None,
            effect: Effect::Allow,
            conditions: Vec::new(),
            priority: 0,
        }
    }

    /// Sets the description.
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Sets the effect.
    pub fn effect(mut self, effect: Effect) -> Self {
        self.effect = effect;
        self
    }

    /// Sets the effect to Allow.
    pub fn allow(mut self) -> Self {
        self.effect = Effect::Allow;
        self
    }

    /// Sets the effect to Deny.
    pub fn deny(mut self) -> Self {
        self.effect = Effect::Deny;
        self
    }

    /// Adds a condition.
    pub fn condition(mut self, condition: crate::types::Condition) -> Self {
        self.conditions.push(condition);
        self
    }

    /// Sets the priority.
    pub fn priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }

    /// Builds the rule.
    pub fn build(self) -> Rule {
        Rule {
            id: self.id,
            description: self.description,
            effect: self.effect,
            conditions: self.conditions,
            priority: self.priority,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Condition, ConditionOperator};

    #[test]
    fn test_policy_from_yaml() {
        let yaml = r#"
id: test-policy
version: "1.0.0"
name: Test Policy
description: A test policy
rules:
  - id: rule-1
    description: Allow members
    effect: allow
    conditions:
      - field: role
        operator: equals
        value: member
    priority: 10
combining_algorithm: deny_overrides
default_effect: deny
"#;

        let policy = Policy::from_yaml(yaml).unwrap();
        assert_eq!(policy.id, "test-policy");
        assert_eq!(policy.rules.len(), 1);
    }

    #[test]
    fn test_rule_builder() {
        let rule = RuleBuilder::new("test-rule")
            .description("Test rule")
            .allow()
            .condition(Condition {
                field: "role".to_string(),
                operator: ConditionOperator::Equals,
                value: serde_json::json!("member"),
            })
            .priority(10)
            .build();

        assert_eq!(rule.id, "test-rule");
        assert_eq!(rule.effect, Effect::Allow);
        assert_eq!(rule.conditions.len(), 1);
    }
}
