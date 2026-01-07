//! Hashing utilities for the policy engine.

use crate::error::{PolicyError, Result};
use sha2::{Digest, Sha256};

/// Computes SHA-256 hash of data and returns hex string.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

/// Computes SHA-256 hash of a string.
pub fn sha256_str(s: &str) -> String {
    sha256_hex(s.as_bytes())
}

/// Computes a content identifier (CID) with prefix.
pub fn compute_cid(data: &str) -> String {
    format!("c:{}", sha256_str(data))
}

/// Computes a head hash for chain linking.
pub fn compute_head_hash(prev_hash: &str, cid: &str) -> String {
    let input = format!("{}:{}", prev_hash, cid);
    format!("h:{}", sha256_str(&input))
}

/// Genesis hash constant.
pub const GENESIS_HASH: &str = "h:genesis";

/// Computes body hash for message bodies.
pub fn compute_body_hash(body: &str) -> String {
    format!("b:{}", sha256_str(body))
}

/// Verifies a hash chain link.
pub fn verify_chain_link(prev_hash: &str, cid: &str, expected_hash: &str) -> bool {
    let computed = compute_head_hash(prev_hash, cid);
    computed == expected_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256() {
        let hash = sha256_str("hello");
        assert_eq!(hash.len(), 64); // SHA-256 is 32 bytes = 64 hex chars
    }

    #[test]
    fn test_cid() {
        let cid = compute_cid("test");
        assert!(cid.starts_with("c:"));
    }

    #[test]
    fn test_head_hash() {
        let head = compute_head_hash(GENESIS_HASH, "c:test");
        assert!(head.starts_with("h:"));
    }

    #[test]
    fn test_verify_chain() {
        let cid = compute_cid("test");
        let head = compute_head_hash(GENESIS_HASH, &cid);
        assert!(verify_chain_link(GENESIS_HASH, &cid, &head));
    }
}
