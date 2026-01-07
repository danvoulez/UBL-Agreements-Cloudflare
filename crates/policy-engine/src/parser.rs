//! Policy file parser.

use crate::error::{PolicyError, Result};
use crate::policy::Policy;

/// Supported policy file formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyFormat {
    Yaml,
    Json,
}

impl PolicyFormat {
    /// Detects format from file extension.
    pub fn from_extension(path: &str) -> Option<Self> {
        if path.ends_with(".yaml") || path.ends_with(".yml") {
            Some(PolicyFormat::Yaml)
        } else if path.ends_with(".json") {
            Some(PolicyFormat::Json)
        } else {
            None
        }
    }

    /// Detects format from content.
    pub fn detect(content: &str) -> Self {
        let trimmed = content.trim();
        if trimmed.starts_with('{') {
            PolicyFormat::Json
        } else {
            PolicyFormat::Yaml
        }
    }
}

/// Parses a policy from a string, auto-detecting format.
pub fn parse_policy(content: &str) -> Result<Policy> {
    let format = PolicyFormat::detect(content);
    parse_policy_with_format(content, format)
}

/// Parses a policy from a string with specified format.
pub fn parse_policy_with_format(content: &str, format: PolicyFormat) -> Result<Policy> {
    match format {
        PolicyFormat::Yaml => Policy::from_yaml(content),
        PolicyFormat::Json => Policy::from_json(content),
    }
}

/// Parses multiple policies from a YAML document with multiple documents.
pub fn parse_policies_yaml(content: &str) -> Result<Vec<Policy>> {
    let mut policies = Vec::new();

    // Split by YAML document separator
    for doc in content.split("---") {
        let trimmed = doc.trim();
        if trimmed.is_empty() {
            continue;
        }

        let policy = Policy::from_yaml(trimmed)?;
        policies.push(policy);
    }

    Ok(policies)
}

/// A policy pack containing multiple policies.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PolicyPack {
    /// Pack identifier.
    pub id: String,

    /// Pack version.
    pub version: String,

    /// Pack name.
    pub name: String,

    /// Pack description.
    #[serde(default)]
    pub description: Option<String>,

    /// Policies in this pack.
    pub policies: Vec<Policy>,

    /// Pack metadata.
    #[serde(default)]
    pub metadata: std::collections::HashMap<String, serde_json::Value>,
}

impl PolicyPack {
    /// Creates a new policy pack.
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            version: "1.0.0".to_string(),
            name: name.into(),
            description: None,
            policies: Vec::new(),
            metadata: std::collections::HashMap::new(),
        }
    }

    /// Adds a policy to the pack.
    pub fn add_policy(&mut self, policy: Policy) {
        self.policies.push(policy);
    }

    /// Parses a policy pack from YAML.
    pub fn from_yaml(yaml: &str) -> Result<Self> {
        let pack: PolicyPack = serde_yaml::from_str(yaml)?;

        // Validate all policies
        for policy in &pack.policies {
            policy.validate()?;
        }

        Ok(pack)
    }

    /// Serializes the pack to YAML.
    pub fn to_yaml(&self) -> Result<String> {
        serde_yaml::to_string(self).map_err(|e| PolicyError::SerializationError(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_detection() {
        assert_eq!(PolicyFormat::detect(r#"{"id": "test"}"#), PolicyFormat::Json);
        assert_eq!(PolicyFormat::detect("id: test"), PolicyFormat::Yaml);
    }

    #[test]
    fn test_parse_yaml() {
        let yaml = r#"
id: test
version: "1.0.0"
name: Test
rules: []
"#;
        let policy = parse_policy(yaml).unwrap();
        assert_eq!(policy.id, "test");
    }

    #[test]
    fn test_parse_json() {
        let json = r#"{"id": "test", "version": "1.0.0", "name": "Test", "rules": []}"#;
        let policy = parse_policy(json).unwrap();
        assert_eq!(policy.id, "test");
    }

    #[test]
    fn test_parse_multiple() {
        let yaml = r#"
id: policy1
version: "1.0.0"
name: Policy 1
rules: []
---
id: policy2
version: "1.0.0"
name: Policy 2
rules: []
"#;
        let policies = parse_policies_yaml(yaml).unwrap();
        assert_eq!(policies.len(), 2);
    }
}
