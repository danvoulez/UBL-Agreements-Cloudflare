//! Error types for the policy engine.

use thiserror::Error;

/// Result type for policy operations.
pub type Result<T> = std::result::Result<T, PolicyError>;

/// Errors that can occur during policy evaluation.
#[derive(Debug, Error)]
pub enum PolicyError {
    /// Policy file could not be parsed.
    #[error("Failed to parse policy: {0}")]
    ParseError(String),

    /// Policy validation failed.
    #[error("Policy validation error: {0}")]
    ValidationError(String),

    /// Required field is missing from context.
    #[error("Missing required field: {0}")]
    MissingField(String),

    /// Invalid field value.
    #[error("Invalid field value for '{field}': {message}")]
    InvalidFieldValue { field: String, message: String },

    /// Condition evaluation failed.
    #[error("Condition evaluation error: {0}")]
    ConditionError(String),

    /// Rule evaluation failed.
    #[error("Rule evaluation error: {0}")]
    RuleError(String),

    /// Policy not found.
    #[error("Policy not found: {0}")]
    NotFound(String),

    /// Serialization/deserialization error.
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// Internal error.
    #[error("Internal error: {0}")]
    InternalError(String),

    /// Hash computation error.
    #[error("Hash computation error: {0}")]
    HashError(String),

    /// Canonicalization error.
    #[error("Canonicalization error: {0}")]
    CanonicalizationError(String),
}

impl From<serde_json::Error> for PolicyError {
    fn from(err: serde_json::Error) -> Self {
        PolicyError::SerializationError(err.to_string())
    }
}

impl From<serde_yaml::Error> for PolicyError {
    fn from(err: serde_yaml::Error) -> Self {
        PolicyError::ParseError(err.to_string())
    }
}

impl From<regex::Error> for PolicyError {
    fn from(err: regex::Error) -> Self {
        PolicyError::ConditionError(format!("Invalid regex: {}", err))
    }
}
