//! Evaluation context for policy decisions.

use crate::error::{PolicyError, Result};
use crate::types::{Action, Environment, Identity, Resource, Role, Tenant};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The complete context for a policy evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationContext {
    /// The identity making the request.
    pub identity: Identity,

    /// The tenant context.
    pub tenant: Tenant,

    /// The resource being accessed.
    pub resource: Resource,

    /// The action being performed.
    pub action: Action,

    /// The role of the identity in the current context.
    pub role: Option<Role>,

    /// Environment information.
    #[serde(default)]
    pub environment: Environment,

    /// Additional context attributes.
    #[serde(default)]
    pub attributes: HashMap<String, serde_json::Value>,
}

impl EvaluationContext {
    /// Creates a new evaluation context.
    pub fn new(
        identity: Identity,
        tenant: Tenant,
        resource: Resource,
        action: Action,
    ) -> Self {
        Self {
            identity,
            tenant,
            resource,
            action,
            role: None,
            environment: Environment::default(),
            attributes: HashMap::new(),
        }
    }

    /// Sets the role for this context.
    pub fn with_role(mut self, role: Role) -> Self {
        self.role = Some(role);
        self
    }

    /// Sets the environment for this context.
    pub fn with_environment(mut self, environment: Environment) -> Self {
        self.environment = environment;
        self
    }

    /// Adds an attribute to the context.
    pub fn with_attribute(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.attributes.insert(key.into(), value);
        self
    }

    /// Gets a value from the context by field path.
    ///
    /// Field paths use dot notation:
    /// - "identity.user_id"
    /// - "tenant.tenant_id"
    /// - "resource.resource_type"
    /// - "action.action_name"
    /// - "role"
    /// - "environment.ip_address"
    /// - "attributes.custom_field"
    pub fn get_value(&self, field_path: &str) -> Option<serde_json::Value> {
        let parts: Vec<&str> = field_path.split('.').collect();

        if parts.is_empty() {
            return None;
        }

        match parts[0] {
            "identity" => self.get_identity_field(&parts[1..]),
            "tenant" => self.get_tenant_field(&parts[1..]),
            "resource" => self.get_resource_field(&parts[1..]),
            "action" => self.get_action_field(&parts[1..]),
            "role" => self.role.as_ref().map(|r| serde_json::json!(r.as_str())),
            "environment" => self.get_environment_field(&parts[1..]),
            "attributes" => {
                if parts.len() > 1 {
                    self.attributes.get(parts[1]).cloned()
                } else {
                    Some(serde_json::json!(self.attributes))
                }
            }
            _ => None,
        }
    }

    fn get_identity_field(&self, parts: &[&str]) -> Option<serde_json::Value> {
        if parts.is_empty() {
            return Some(serde_json::to_value(&self.identity).ok()?);
        }

        match parts[0] {
            "user_id" => Some(serde_json::json!(self.identity.user_id)),
            "email" => Some(serde_json::json!(self.identity.email)),
            "email_domain" => Some(serde_json::json!(self.identity.email_domain)),
            "groups" => Some(serde_json::json!(self.identity.groups)),
            "is_service" => Some(serde_json::json!(self.identity.is_service)),
            _ => None,
        }
    }

    fn get_tenant_field(&self, parts: &[&str]) -> Option<serde_json::Value> {
        if parts.is_empty() {
            return Some(serde_json::to_value(&self.tenant).ok()?);
        }

        match parts[0] {
            "tenant_id" => Some(serde_json::json!(self.tenant.tenant_id)),
            "tenant_type" => Some(serde_json::json!(self.tenant.tenant_type)),
            _ => None,
        }
    }

    fn get_resource_field(&self, parts: &[&str]) -> Option<serde_json::Value> {
        if parts.is_empty() {
            return Some(serde_json::to_value(&self.resource).ok()?);
        }

        match parts[0] {
            "resource_type" => Some(serde_json::json!(self.resource.resource_type.as_str())),
            "resource_id" => Some(serde_json::json!(self.resource.resource_id)),
            "owner_id" => self.resource.owner_id.as_ref().map(|v| serde_json::json!(v)),
            "agreement_id" => self.resource.agreement_id.as_ref().map(|v| serde_json::json!(v)),
            _ => None,
        }
    }

    fn get_action_field(&self, parts: &[&str]) -> Option<serde_json::Value> {
        if parts.is_empty() {
            return Some(serde_json::to_value(&self.action).ok()?);
        }

        match parts[0] {
            "action_type" => Some(serde_json::json!(self.action.action_type.as_str())),
            "action_name" => Some(serde_json::json!(self.action.action_name)),
            _ => None,
        }
    }

    fn get_environment_field(&self, parts: &[&str]) -> Option<serde_json::Value> {
        if parts.is_empty() {
            return Some(serde_json::to_value(&self.environment).ok()?);
        }

        match parts[0] {
            "timestamp" => self.environment.timestamp.as_ref().map(|v| serde_json::json!(v)),
            "request_id" => self.environment.request_id.as_ref().map(|v| serde_json::json!(v)),
            "ip_address" => self.environment.ip_address.as_ref().map(|v| serde_json::json!(v)),
            "user_agent" => self.environment.user_agent.as_ref().map(|v| serde_json::json!(v)),
            "attributes" => {
                if parts.len() > 1 {
                    self.environment.attributes.get(parts[1]).cloned()
                } else {
                    Some(serde_json::json!(self.environment.attributes))
                }
            }
            _ => None,
        }
    }

    /// Validates that required fields are present.
    pub fn validate(&self) -> Result<()> {
        if self.identity.user_id.is_empty() {
            return Err(PolicyError::MissingField("identity.user_id".to_string()));
        }
        if self.tenant.tenant_id.is_empty() {
            return Err(PolicyError::MissingField("tenant.tenant_id".to_string()));
        }
        if self.resource.resource_id.is_empty() {
            return Err(PolicyError::MissingField("resource.resource_id".to_string()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ActionType, ResourceType, TenantType};

    fn create_test_context() -> EvaluationContext {
        EvaluationContext::new(
            Identity {
                user_id: "u:test".to_string(),
                email: "test@example.com".to_string(),
                email_domain: "example.com".to_string(),
                groups: vec!["admin".to_string()],
                is_service: false,
            },
            Tenant {
                tenant_id: "t:example.com".to_string(),
                tenant_type: TenantType::Customer,
            },
            Resource {
                resource_type: ResourceType::Room,
                resource_id: "r:general".to_string(),
                owner_id: Some("u:owner".to_string()),
                agreement_id: Some("a:room:r:general".to_string()),
            },
            Action {
                action_type: ActionType::Write,
                action_name: "messenger.send".to_string(),
            },
        )
        .with_role(Role::Member)
    }

    #[test]
    fn test_get_identity_field() {
        let ctx = create_test_context();

        assert_eq!(
            ctx.get_value("identity.user_id"),
            Some(serde_json::json!("u:test"))
        );
        assert_eq!(
            ctx.get_value("identity.email"),
            Some(serde_json::json!("test@example.com"))
        );
    }

    #[test]
    fn test_get_role() {
        let ctx = create_test_context();

        assert_eq!(
            ctx.get_value("role"),
            Some(serde_json::json!("member"))
        );
    }

    #[test]
    fn test_validate() {
        let ctx = create_test_context();
        assert!(ctx.validate().is_ok());
    }
}
