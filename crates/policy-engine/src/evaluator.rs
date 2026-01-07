//! Policy evaluation engine.

use crate::context::EvaluationContext;
use crate::decision::{Decision, PolicyDecision};
use crate::error::{PolicyError, Result};
use crate::policy::Policy;
use crate::types::{CombiningAlgorithm, Condition, ConditionOperator, Effect, Rule};
use regex::Regex;
use std::time::Instant;

/// The policy evaluator.
#[derive(Debug)]
pub struct PolicyEvaluator {
    policies: Vec<Policy>,
}

impl PolicyEvaluator {
    /// Creates a new evaluator with no policies.
    pub fn new() -> Self {
        Self {
            policies: Vec::new(),
        }
    }

    /// Adds a policy to the evaluator.
    pub fn add_policy(&mut self, policy: Policy) {
        self.policies.push(policy);
    }

    /// Loads a policy from YAML.
    pub fn load_policy_yaml(&mut self, yaml: &str) -> Result<()> {
        let policy = Policy::from_yaml(yaml)?;
        self.add_policy(policy);
        Ok(())
    }

    /// Evaluates all policies against the context.
    pub fn evaluate(&self, context: &EvaluationContext) -> Result<PolicyDecision> {
        let start = Instant::now();

        // Validate context
        context.validate()?;

        // If no policies, deny by default
        if self.policies.is_empty() {
            return Ok(PolicyDecision::default_deny()
                .with_evaluation_time(start.elapsed().as_micros() as u64));
        }

        // Evaluate each policy
        let mut decisions: Vec<PolicyDecision> = Vec::new();

        for policy in &self.policies {
            let decision = self.evaluate_policy(policy, context)?;
            decisions.push(decision);
        }

        // Combine decisions (use deny-overrides by default across policies)
        let final_decision = self.combine_decisions(&decisions, CombiningAlgorithm::DenyOverrides);

        Ok(final_decision.with_evaluation_time(start.elapsed().as_micros() as u64))
    }

    /// Evaluates a single policy.
    fn evaluate_policy(&self, policy: &Policy, context: &EvaluationContext) -> Result<PolicyDecision> {
        let sorted_rules = policy.sorted_rules();
        let mut matched_decisions: Vec<(Effect, &Rule)> = Vec::new();

        for rule in sorted_rules {
            if self.evaluate_rule(rule, context)? {
                matched_decisions.push((rule.effect, rule));
            }
        }

        if matched_decisions.is_empty() {
            // No rules matched, use default effect
            let decision = if policy.default_effect == Effect::Allow {
                PolicyDecision::default_allow()
            } else {
                PolicyDecision::default_deny()
            };
            return Ok(decision.with_policy_id(&policy.id));
        }

        // Apply combining algorithm
        let decision = match policy.combining_algorithm {
            CombiningAlgorithm::FirstApplicable => {
                let (effect, rule) = &matched_decisions[0];
                let dec = if *effect == Effect::Allow {
                    PolicyDecision::allow(format!("Rule '{}' matched", rule.id))
                } else {
                    PolicyDecision::deny(format!("Rule '{}' matched", rule.id))
                };
                dec.with_rule_id(&rule.id)
            }

            CombiningAlgorithm::DenyOverrides => {
                // If any rule denies, deny
                for (effect, rule) in &matched_decisions {
                    if *effect == Effect::Deny {
                        return Ok(PolicyDecision::deny(format!("Rule '{}' denies", rule.id))
                            .with_rule_id(&rule.id)
                            .with_policy_id(&policy.id));
                    }
                }
                // All rules allow
                let (_, rule) = &matched_decisions[0];
                PolicyDecision::allow("All matching rules allow")
                    .with_rule_id(&rule.id)
            }

            CombiningAlgorithm::AllowOverrides => {
                // If any rule allows, allow
                for (effect, rule) in &matched_decisions {
                    if *effect == Effect::Allow {
                        return Ok(PolicyDecision::allow(format!("Rule '{}' allows", rule.id))
                            .with_rule_id(&rule.id)
                            .with_policy_id(&policy.id));
                    }
                }
                // All rules deny
                let (_, rule) = &matched_decisions[0];
                PolicyDecision::deny("All matching rules deny")
                    .with_rule_id(&rule.id)
            }

            CombiningAlgorithm::UnanimousAllow => {
                // All rules must allow
                for (effect, rule) in &matched_decisions {
                    if *effect == Effect::Deny {
                        return Ok(PolicyDecision::deny(format!("Rule '{}' denies (unanimous allow required)", rule.id))
                            .with_rule_id(&rule.id)
                            .with_policy_id(&policy.id));
                    }
                }
                let (_, rule) = &matched_decisions[0];
                PolicyDecision::allow("All rules unanimously allow")
                    .with_rule_id(&rule.id)
            }

            CombiningAlgorithm::UnanimousDeny => {
                // All rules must deny
                for (effect, rule) in &matched_decisions {
                    if *effect == Effect::Allow {
                        return Ok(PolicyDecision::allow(format!("Rule '{}' allows (unanimous deny required)", rule.id))
                            .with_rule_id(&rule.id)
                            .with_policy_id(&policy.id));
                    }
                }
                let (_, rule) = &matched_decisions[0];
                PolicyDecision::deny("All rules unanimously deny")
                    .with_rule_id(&rule.id)
            }
        };

        Ok(decision.with_policy_id(&policy.id))
    }

    /// Evaluates a single rule against the context.
    fn evaluate_rule(&self, rule: &Rule, context: &EvaluationContext) -> Result<bool> {
        // All conditions must match
        for condition in &rule.conditions {
            if !self.evaluate_condition(condition, context)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Evaluates a single condition.
    fn evaluate_condition(&self, condition: &Condition, context: &EvaluationContext) -> Result<bool> {
        let field_value = context.get_value(&condition.field);

        match condition.operator {
            ConditionOperator::Exists => Ok(field_value.is_some()),
            ConditionOperator::NotExists => Ok(field_value.is_none()),
            _ => {
                let field_value = field_value.ok_or_else(|| {
                    PolicyError::ConditionError(format!("Field '{}' not found", condition.field))
                })?;

                self.evaluate_operator(&condition.operator, &field_value, &condition.value)
            }
        }
    }

    /// Evaluates an operator.
    fn evaluate_operator(
        &self,
        operator: &ConditionOperator,
        left: &serde_json::Value,
        right: &serde_json::Value,
    ) -> Result<bool> {
        match operator {
            ConditionOperator::Equals => Ok(left == right),
            ConditionOperator::NotEquals => Ok(left != right),

            ConditionOperator::Contains => {
                if let (Some(left_str), Some(right_str)) = (left.as_str(), right.as_str()) {
                    Ok(left_str.contains(right_str))
                } else if let Some(left_arr) = left.as_array() {
                    Ok(left_arr.contains(right))
                } else {
                    Ok(false)
                }
            }

            ConditionOperator::NotContains => {
                let contains = self.evaluate_operator(&ConditionOperator::Contains, left, right)?;
                Ok(!contains)
            }

            ConditionOperator::StartsWith => {
                if let (Some(left_str), Some(right_str)) = (left.as_str(), right.as_str()) {
                    Ok(left_str.starts_with(right_str))
                } else {
                    Ok(false)
                }
            }

            ConditionOperator::EndsWith => {
                if let (Some(left_str), Some(right_str)) = (left.as_str(), right.as_str()) {
                    Ok(left_str.ends_with(right_str))
                } else {
                    Ok(false)
                }
            }

            ConditionOperator::Matches => {
                if let (Some(left_str), Some(pattern)) = (left.as_str(), right.as_str()) {
                    let regex = Regex::new(pattern)?;
                    Ok(regex.is_match(left_str))
                } else {
                    Ok(false)
                }
            }

            ConditionOperator::In => {
                if let Some(right_arr) = right.as_array() {
                    Ok(right_arr.contains(left))
                } else {
                    Ok(false)
                }
            }

            ConditionOperator::NotIn => {
                let is_in = self.evaluate_operator(&ConditionOperator::In, left, right)?;
                Ok(!is_in)
            }

            ConditionOperator::GreaterThan => {
                self.compare_numbers(left, right, |l, r| l > r)
            }

            ConditionOperator::LessThan => {
                self.compare_numbers(left, right, |l, r| l < r)
            }

            ConditionOperator::GreaterThanOrEqual => {
                self.compare_numbers(left, right, |l, r| l >= r)
            }

            ConditionOperator::LessThanOrEqual => {
                self.compare_numbers(left, right, |l, r| l <= r)
            }

            ConditionOperator::Exists | ConditionOperator::NotExists => {
                // These are handled earlier
                Ok(false)
            }
        }
    }

    /// Compares two numeric values.
    fn compare_numbers<F>(&self, left: &serde_json::Value, right: &serde_json::Value, cmp: F) -> Result<bool>
    where
        F: Fn(f64, f64) -> bool,
    {
        let left_num = left.as_f64().ok_or_else(|| {
            PolicyError::ConditionError("Left value is not a number".to_string())
        })?;
        let right_num = right.as_f64().ok_or_else(|| {
            PolicyError::ConditionError("Right value is not a number".to_string())
        })?;

        Ok(cmp(left_num, right_num))
    }

    /// Combines multiple policy decisions.
    fn combine_decisions(&self, decisions: &[PolicyDecision], algorithm: CombiningAlgorithm) -> PolicyDecision {
        if decisions.is_empty() {
            return PolicyDecision::default_deny();
        }

        match algorithm {
            CombiningAlgorithm::FirstApplicable => {
                decisions[0].clone()
            }

            CombiningAlgorithm::DenyOverrides => {
                for decision in decisions {
                    if decision.is_denied() {
                        return decision.clone();
                    }
                }
                decisions.iter()
                    .find(|d| d.is_allowed())
                    .cloned()
                    .unwrap_or_else(PolicyDecision::default_deny)
            }

            CombiningAlgorithm::AllowOverrides => {
                for decision in decisions {
                    if decision.is_allowed() {
                        return decision.clone();
                    }
                }
                decisions.iter()
                    .find(|d| d.is_denied())
                    .cloned()
                    .unwrap_or_else(PolicyDecision::default_deny)
            }

            CombiningAlgorithm::UnanimousAllow => {
                if decisions.iter().all(|d| d.is_allowed()) {
                    decisions[0].clone()
                } else {
                    decisions.iter()
                        .find(|d| d.is_denied())
                        .cloned()
                        .unwrap_or_else(PolicyDecision::default_deny)
                }
            }

            CombiningAlgorithm::UnanimousDeny => {
                if decisions.iter().all(|d| d.is_denied()) {
                    decisions[0].clone()
                } else {
                    decisions.iter()
                        .find(|d| d.is_allowed())
                        .cloned()
                        .unwrap_or_else(PolicyDecision::default_allow)
                }
            }
        }
    }
}

impl Default for PolicyEvaluator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Action, ActionType, Identity, Resource, ResourceType, Role, Tenant, TenantType};

    fn create_test_context(role: Role) -> EvaluationContext {
        EvaluationContext::new(
            Identity {
                user_id: "u:test".to_string(),
                email: "test@example.com".to_string(),
                email_domain: "example.com".to_string(),
                groups: vec!["developers".to_string()],
                is_service: false,
            },
            Tenant {
                tenant_id: "t:example.com".to_string(),
                tenant_type: TenantType::Customer,
            },
            Resource {
                resource_type: ResourceType::Room,
                resource_id: "r:general".to_string(),
                owner_id: None,
                agreement_id: None,
            },
            Action {
                action_type: ActionType::Write,
                action_name: "messenger.send".to_string(),
            },
        )
        .with_role(role)
    }

    #[test]
    fn test_basic_evaluation() {
        let policy_yaml = r#"
id: basic-policy
version: "1.0.0"
name: Basic Policy
rules:
  - id: allow-members
    effect: allow
    conditions:
      - field: role
        operator: equals
        value: member
    priority: 10
default_effect: deny
"#;

        let mut evaluator = PolicyEvaluator::new();
        evaluator.load_policy_yaml(policy_yaml).unwrap();

        // Member should be allowed
        let ctx = create_test_context(Role::Member);
        let decision = evaluator.evaluate(&ctx).unwrap();
        assert!(decision.is_allowed());

        // Guest should be denied (default)
        let ctx = create_test_context(Role::Guest);
        let decision = evaluator.evaluate(&ctx).unwrap();
        assert!(decision.is_denied());
    }

    #[test]
    fn test_deny_overrides() {
        let policy_yaml = r#"
id: deny-override-policy
version: "1.0.0"
name: Deny Override Policy
combining_algorithm: deny_overrides
rules:
  - id: allow-all
    effect: allow
    conditions: []
    priority: 1
  - id: deny-guests
    effect: deny
    conditions:
      - field: role
        operator: equals
        value: guest
    priority: 10
default_effect: deny
"#;

        let mut evaluator = PolicyEvaluator::new();
        evaluator.load_policy_yaml(policy_yaml).unwrap();

        // Member should be allowed
        let ctx = create_test_context(Role::Member);
        let decision = evaluator.evaluate(&ctx).unwrap();
        assert!(decision.is_allowed());

        // Guest should be denied (deny overrides)
        let ctx = create_test_context(Role::Guest);
        let decision = evaluator.evaluate(&ctx).unwrap();
        assert!(decision.is_denied());
    }
}
