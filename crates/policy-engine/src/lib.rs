//! UBL Policy Engine
//!
//! A deterministic policy evaluation engine that compiles to both WASM
//! (for Cloudflare Workers) and native (for on-prem proxies).
//!
//! This implements TDLN (To-Do Language for Nodes) policy evaluation,
//! providing the "brain" for access control decisions in the UBL system.

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc;

pub mod canonicalization;
pub mod context;
pub mod decision;
pub mod error;
pub mod evaluator;
pub mod hash;
pub mod parser;
pub mod policy;
pub mod types;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use context::EvaluationContext;
pub use decision::{Decision, PolicyDecision};
pub use error::{PolicyError, Result};
pub use evaluator::PolicyEvaluator;
pub use policy::Policy;

/// Version of the policy engine.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Re-export commonly used types.
pub mod prelude {
    pub use crate::context::EvaluationContext;
    pub use crate::decision::{Decision, PolicyDecision};
    pub use crate::error::{PolicyError, Result};
    pub use crate::evaluator::PolicyEvaluator;
    pub use crate::policy::Policy;
    pub use crate::types::*;
}
