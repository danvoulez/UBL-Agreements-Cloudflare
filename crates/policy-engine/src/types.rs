//! Core types for the policy engine.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Represents a user identity in the policy context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub user_id: String,
    pub email: String,
    pub email_domain: String,
    pub groups: Vec<String>,
    pub is_service: bool,
}

/// Represents a tenant in the policy context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub tenant_id: String,
    pub tenant_type: TenantType,
}

/// Type of tenant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TenantType {
    Platform,
    Customer,
}

/// Represents a resource being accessed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub resource_type: ResourceType,
    pub resource_id: String,
    pub owner_id: Option<String>,
    pub agreement_id: Option<String>,
}

/// Type of resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceType {
    Tenant,
    Room,
    Message,
    Workspace,
    Document,
    Tool,
    Receipt,
}

impl ResourceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ResourceType::Tenant => "tenant",
            ResourceType::Room => "room",
            ResourceType::Message => "message",
            ResourceType::Workspace => "workspace",
            ResourceType::Document => "document",
            ResourceType::Tool => "tool",
            ResourceType::Receipt => "receipt",
        }
    }
}

/// Represents an action being performed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub action_type: ActionType,
    pub action_name: String,
}

/// Type of action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionType {
    Read,
    Write,
    Create,
    Delete,
    Execute,
    Admin,
}

impl ActionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ActionType::Read => "read",
            ActionType::Write => "write",
            ActionType::Create => "create",
            ActionType::Delete => "delete",
            ActionType::Execute => "execute",
            ActionType::Admin => "admin",
        }
    }
}

/// Role within a context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Guest,
    Member,
    Admin,
    Owner,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Guest => "guest",
            Role::Member => "member",
            Role::Admin => "admin",
            Role::Owner => "owner",
        }
    }

    /// Returns true if this role has at least the given permission level.
    pub fn has_permission(&self, required: Role) -> bool {
        *self >= required
    }
}

/// Environment context for policy evaluation.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Environment {
    pub timestamp: Option<String>,
    pub request_id: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub attributes: HashMap<String, serde_json::Value>,
}

/// Condition operator for rule matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    Matches,
    In,
    NotIn,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    Exists,
    NotExists,
}

/// A condition in a policy rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub field: String,
    pub operator: ConditionOperator,
    pub value: serde_json::Value,
}

/// Effect of a policy rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Allow,
    Deny,
}

/// A single rule in a policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub description: Option<String>,
    pub effect: Effect,
    pub conditions: Vec<Condition>,
    pub priority: i32,
}

/// Combining algorithm for multiple rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CombiningAlgorithm {
    /// First applicable rule wins
    FirstApplicable,
    /// Deny takes precedence
    DenyOverrides,
    /// Allow takes precedence
    AllowOverrides,
    /// All rules must allow
    UnanimousAllow,
    /// All rules must deny
    UnanimousDeny,
}

impl Default for CombiningAlgorithm {
    fn default() -> Self {
        CombiningAlgorithm::DenyOverrides
    }
}
