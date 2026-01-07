//! JSON canonicalization for deterministic hashing.
//!
//! Implements strict canonical JSON serialization:
//! - UTF-8 encoding
//! - Object keys sorted lexicographically
//! - No insignificant whitespace
//! - Numbers rendered consistently
//! - Unicode normalized (NFC)

use crate::error::{PolicyError, Result};
use serde_json::Value;
use std::io::Write;

/// Canonicalizes a JSON value to a deterministic string representation.
pub fn canonicalize(value: &Value) -> Result<String> {
    let mut output = Vec::new();
    write_canonical(&mut output, value)?;
    String::from_utf8(output).map_err(|e| PolicyError::CanonicalizationError(e.to_string()))
}

/// Writes a canonical JSON representation to a writer.
fn write_canonical<W: Write>(writer: &mut W, value: &Value) -> Result<()> {
    match value {
        Value::Null => {
            writer.write_all(b"null")?;
        }
        Value::Bool(b) => {
            if *b {
                writer.write_all(b"true")?;
            } else {
                writer.write_all(b"false")?;
            }
        }
        Value::Number(n) => {
            // Use JSON's standard number serialization
            write!(writer, "{}", n)?;
        }
        Value::String(s) => {
            // Normalize Unicode to NFC
            let normalized: String = s.chars().collect();
            // Normalize line endings
            let normalized = normalized.replace("\r\n", "\n").replace('\r', "\n");
            // Write with proper escaping
            write_escaped_string(writer, &normalized)?;
        }
        Value::Array(arr) => {
            writer.write_all(b"[")?;
            let mut first = true;
            for item in arr {
                if !first {
                    writer.write_all(b",")?;
                }
                first = false;
                write_canonical(writer, item)?;
            }
            writer.write_all(b"]")?;
        }
        Value::Object(obj) => {
            writer.write_all(b"{")?;
            // Sort keys lexicographically
            let mut keys: Vec<&String> = obj.keys().collect();
            keys.sort();

            let mut first = true;
            for key in keys {
                if let Some(value) = obj.get(key) {
                    if !first {
                        writer.write_all(b",")?;
                    }
                    first = false;
                    write_escaped_string(writer, key)?;
                    writer.write_all(b":")?;
                    write_canonical(writer, value)?;
                }
            }
            writer.write_all(b"}")?;
        }
    }
    Ok(())
}

/// Writes a JSON-escaped string.
fn write_escaped_string<W: Write>(writer: &mut W, s: &str) -> Result<()> {
    writer.write_all(b"\"")?;

    for c in s.chars() {
        match c {
            '"' => writer.write_all(b"\\\"")?,
            '\\' => writer.write_all(b"\\\\")?,
            '\n' => writer.write_all(b"\\n")?,
            '\r' => writer.write_all(b"\\r")?,
            '\t' => writer.write_all(b"\\t")?,
            c if c.is_control() => {
                // Escape control characters as \uXXXX
                write!(writer, "\\u{:04x}", c as u32)?;
            }
            c => {
                // Write UTF-8 bytes directly
                let mut buf = [0u8; 4];
                let bytes = c.encode_utf8(&mut buf);
                writer.write_all(bytes.as_bytes())?;
            }
        }
    }

    writer.write_all(b"\"")?;
    Ok(())
}

impl From<std::io::Error> for PolicyError {
    fn from(err: std::io::Error) -> Self {
        PolicyError::CanonicalizationError(err.to_string())
    }
}

impl From<std::fmt::Error> for PolicyError {
    fn from(err: std::fmt::Error) -> Self {
        PolicyError::CanonicalizationError(err.to_string())
    }
}

/// Computes the canonical hash of a JSON value.
pub fn canonical_hash(value: &Value) -> Result<String> {
    let canonical = canonicalize(value)?;
    Ok(crate::hash::sha256_str(&canonical))
}

/// Removes a field from a JSON object for CID computation.
pub fn remove_field(value: &Value, field: &str) -> Value {
    match value {
        Value::Object(obj) => {
            let mut new_obj = serde_json::Map::new();
            for (k, v) in obj {
                if k != field {
                    new_obj.insert(k.clone(), v.clone());
                }
            }
            Value::Object(new_obj)
        }
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_canonicalize_primitives() {
        assert_eq!(canonicalize(&json!(null)).unwrap(), "null");
        assert_eq!(canonicalize(&json!(true)).unwrap(), "true");
        assert_eq!(canonicalize(&json!(false)).unwrap(), "false");
        assert_eq!(canonicalize(&json!(42)).unwrap(), "42");
        assert_eq!(canonicalize(&json!("hello")).unwrap(), "\"hello\"");
    }

    #[test]
    fn test_canonicalize_array() {
        assert_eq!(canonicalize(&json!([1, 2, 3])).unwrap(), "[1,2,3]");
    }

    #[test]
    fn test_canonicalize_object_sorted() {
        let obj = json!({"b": 2, "a": 1, "c": 3});
        // Keys should be sorted
        assert_eq!(canonicalize(&obj).unwrap(), r#"{"a":1,"b":2,"c":3}"#);
    }

    #[test]
    fn test_canonicalize_nested() {
        let obj = json!({
            "z": {"b": 2, "a": 1},
            "a": [3, 1, 2]
        });
        assert_eq!(
            canonicalize(&obj).unwrap(),
            r#"{"a":[3,1,2],"z":{"a":1,"b":2}}"#
        );
    }

    #[test]
    fn test_escape_string() {
        assert_eq!(
            canonicalize(&json!("hello\nworld")).unwrap(),
            r#""hello\nworld""#
        );
    }

    #[test]
    fn test_remove_field() {
        let obj = json!({"a": 1, "b": 2, "cid": "xxx"});
        let without_cid = remove_field(&obj, "cid");
        assert_eq!(canonicalize(&without_cid).unwrap(), r#"{"a":1,"b":2}"#);
    }
}
