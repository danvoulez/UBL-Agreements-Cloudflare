Blueprint — UBL Messenger + LogLine/UBL Runtime on Cloudflare One (Cloudflare = your only computer)

## What is This?

This document describes the architecture and implementation plan for **UBL (Universal Business Ledger)** — a verifiable, receipt-based system for agent economies, built entirely on Cloudflare's platform.

**UBL** is an append-only ledger that records every action as a cryptographically linked "receipt" (an atom with hash chain). Every action references an **Agreement** (the authorization) and produces an **effect** (the consequence). This creates a complete, tamper-proof audit trail where relationships (Agreements) are first-class citizens, not just permissions.

**LogLine Protocol** is the conceptual framework: every action must be structured, signed, and committed before execution. It inverts the relationship between execution and record-keeping — you can't act without first declaring your intent and its consequences.

**MCP (Model Context Protocol)** is how agents and tools communicate. Instead of exposing dozens of API endpoints, we expose one MCP Portal URL that aggregates all tools, with governance and logging built-in.

**Why Cloudflare?** Because it gives us:
- **Durable Objects**: Strongly consistent, globally unique state (perfect for ordered ledgers)
- **Workers**: Edge functions that run everywhere
- **MCP Portals**: Tool marketplace with built-in governance
- **Zero Trust Access**: Identity and policy enforcement
- **AI Gateway + Firewall**: Hardened LLM perimeter
- **Everything in one platform**: No infrastructure management

**What You're Building (MVP-1):**
- A messenger (chat rooms with ordered messages)
- An office (document management with LLM integration)
- A ledger (every action produces a receipt)
- MCP integration (tools exposed and consumed via MCP)
- All receipted, all verifiable, all governed by Agreements

---

## Technology Stack

### Languages

**Rust** is the primary language for:
- **Policy Engine (TDLN)**: Compiles to WASM (for Cloudflare Workers) and native (for on-prem proxies)
- **Core Libraries**: Canonicalization, hashing, signature verification
- **Workers (TypeScript)**: While Workers run TypeScript/JavaScript, the policy evaluation uses Rust-compiled WASM

**YAML** is used for:
- **Policies (Chip-as-Code)**: All policies are written in YAML using the TDLN format
- **Configuration**: Policy definitions, wiring, and outputs are declarative YAML
- **Example**: `policies/ubl_core_v1.yaml` defines access control policies as YAML

**Why Rust?**
- Performance: Native speed for policy evaluation
- Safety: Memory safety without garbage collection
- WASM: Compiles to WebAssembly for edge execution
- Determinism: Same code, same results (critical for verifiability)

**Why YAML?**
- Human-readable: Policies are readable and auditable
- Declarative: Intent is clear, not buried in code
- Versionable: Policies can be versioned and signed
- Portable: Same YAML works in Rust, TypeScript, or any TDLN implementation

---

## Final Architecture (Post-MVP-1)

### Core Components

**1. Gateway Worker (TypeScript)**
- Routes requests to appropriate services
- Tenant resolution and identity normalization
- Multitenancy enforcement
- MCP endpoint aggregation

**2. UBL Ledger Worker (TypeScript)**
- Single source of truth for all receipts
- D1 database for indices (fast queries)
- R2 bucket for immutable storage (append-only JSONL)
- Hash chain enforcement
- Agreement tracking

**3. Office Worker (TypeScript)**
- Document management (create, get, search)
- LLM Gateway (routes to AI Gateway)
- Workspace management
- MCP Server (exposes `office.*` tools)
- MCP Client (consumes `messenger.*` and external tools)

**4. Messenger Worker (TypeScript)**
- Chat rooms with ordered messages
- Real-time streaming (SSE)
- Room membership (Agreements)
- MCP Server (exposes `messenger.*` tools)

**5. Policy Engine (Rust → WASM)**
- TDLN policy evaluation
- Compiles to WASM for edge execution
- Same codebase compiles to native for on-prem
- Deterministic evaluation (same input = same output)

### Data Layer

**Durable Objects:**
- `TenantObject`: Tenant membership, room directory
- `RoomObject`: Ordered message timeline, SSE subscribers
- `LedgerShardObject`: Append-only receipt atoms with hash chain
- `ContainerObject` (future): Unified container primitive

**D1 (SQL Database):**
- Indices for fast queries (tenant lookup, room listing)
- Receipt metadata (seq, cid, head_hash lookup)
- Agreement registry

**R2 (Object Storage):**
- Immutable ledger atoms (append-only JSONL)
- Document storage (Office)
- Archives and snapshots

**KV (Key-Value):**
- Policy packs (signed YAML policies)
- Configuration
- Cache

### External Integrations

**Cloudflare Access:**
- Identity and authentication
- Zero Trust enforcement
- Service tokens for bots

**MCP Portal:**
- Tool marketplace
- Tool curation and governance
- Access logs for tool calls

**AI Gateway:**
- LLM call routing
- Caching and rate limiting
- Cost tracking

**Firewall for AI:**
- PII detection
- Prompt injection detection
- Unsafe topic detection

### Deployment Model

**Cloudflare Workers (Edge):**
- All Workers run at the edge (global distribution)
- Low latency (< 50ms p95)
- Auto-scaling

**On-Prem (Optional):**
- Rust proxy for policy evaluation (same TDLN codebase)
- Syncs with Cloudflare for break-glass state
- Local ledger for audit

### Data Flow

```
User/Agent → Gateway Worker
              ├─→ Access (identity)
              ├─→ Policy Engine (WASM) → Allow/Deny
              └─→ Route to:
                  ├─→ Messenger Worker → RoomObject → LedgerShardObject
                  ├─→ Office Worker → Workspace → LedgerShardObject
                  └─→ MCP Portal → Tools → LedgerShardObject

All actions → LedgerShardObject → R2 (immutable) + D1 (index)
```

### Key Principles

1. **Single Ledger**: One UBL Ledger for all receipts (not per-service)
2. **Agreement-First**: Every action references an Agreement
3. **Event Sourcing**: State is derived from events
4. **Container Primitive**: Rooms, Workspaces, Wallets use same code
5. **MCP-First**: Tools exposed via MCP, not REST (though REST exists for PWA)

---

## Quick Glossary

**Agreement**: A formal relationship that authorizes actions. Examples: RoomMembership Agreement (authorizes sending messages), WorkspaceAgreement (authorizes creating documents).

**Atom**: A single entry in the ledger. Two types: `action.v1` (what was attempted) and `effect.v1` (what happened).

**Container**: A primitive that holds other assets, governed by an Agreement. Rooms, Workspaces, and Wallets are all Containers with different "physics" (how items move/copy/persist).

**Durable Object (DO)**: Cloudflare's strongly consistent, globally unique state primitive. Perfect for ordered sequences (like chat timelines or ledger shards).

**Hash Chain**: Each ledger atom includes the hash of the previous atom. This creates an immutable chain — if any atom is modified, the chain breaks.

**Ledger Shard**: A partition of the ledger. MVP-1 uses one shard per tenant (shard_id = "0"). Later, you can shard horizontally.

**MCP (Model Context Protocol)**: A protocol for agents to discover and call tools. Instead of REST APIs, tools are exposed as MCP tools with JSON schemas.

**MCP Portal**: Cloudflare's service that aggregates multiple MCP servers under one URL, with tool curation and logging.

**Receipt**: The response from appending an atom to the ledger: `{seq, cid, head_hash}`. This proves the action was recorded.

**Worker**: Cloudflare's edge function runtime. Code runs at the edge, close to users, with low latency.

**Workspace**: A Container that holds Documents. "Office" is the application that manages Workspaces.

**SSE (Server-Sent Events)**: A web standard for streaming events from server to client. Used for real-time updates (new messages, room events) without polling. Better than WebSockets for mobile (handles reconnects gracefully).

**JSON-RPC**: A protocol for remote procedure calls using JSON. MCP uses JSON-RPC 2.0 for tool calls (initialize, tools/list, tools/call).

**PWA (Progressive Web App)**: A web app that works like a native app (installable, works offline, push notifications). The Messenger UI is a PWA that runs on iPhone.

**E2EE (End-to-End Encryption)**: Encryption where only the sender and receiver can read messages. The server never sees plaintext. Planned for MVP-3.

**Zero Trust**: A security model where you never trust, always verify. Every request is authenticated and authorized, even from inside your network. Cloudflare Access implements this.

---

## The Architecture in One Sentence

Cloudflare Zero Trust is your enforcement fabric + MCP is your tool bus + Durable Objects are your ordered state + Workflows/Queues/Containers/Sandbox are your execution substrate + AI Gateway/Firewall for AI are your model perimeter. Everything is operable from iPhone (PWA) and everything is accessible via API + MCP + MCP streaming.

0) The Philosophy (the poetry that makes it universal)

**Why this matters:** These principles aren't just nice ideas — they're the foundation that makes UBL universal, verifiable, and auditable. Every implementation decision traces back to these principles.
0.1 Agreement-First: Every Relationship is an Agreement

**The principle:** "There are no static relationships. There are no inherent roles. Everything exists because of agreements—explicit or implicit, formal or informal, but always agreements."

**What this means in practice:** Instead of storing "user X has role Y", you store "Agreement #123 establishes that user X has role Y in context Z". The Agreement is the source of truth, not a derived permission.

In UBL:
- Every room membership is an Agreement (RoomMembership Agreement)
- Every tenant license is an Agreement (TenantLicense Agreement)
- Every tool permission is an Agreement (ToolAccess Agreement)
- Every workflow approval is an Agreement (WorkflowApproval Agreement)

This means:
- Roles are not attributes; they are relationships established by agreements
- Permissions trace to their establishment agreement
- Every action has provenance: "who did what, when, under which agreement"
- The ledger records agreements, not just events

0.2 Container Primitive: Every Boundary is a Container

**The principle:** "A Container is an Asset that holds other Assets, governed by an Agreement."

**What this means:** Instead of writing separate code for Rooms, Workspaces, and Wallets, you write one Container primitive. The difference is in the "physics" (configuration), not the implementation.

The fractal nature:
- A Room is a Container (holds Messages, governed by RoomGovernance Agreement)
- A Tenant is a Container (holds Rooms, Entities, governed by TenantLicense Agreement)
- A Workspace is a Container (holds Documents, governed by WorkspaceAgreement)
  - Note: "Office" is the application that manages Workspaces; the Container itself is the Workspace
- A Wallet is a Container (holds Credits, governed by WalletAgreement)

The physics of containers (configuration, not implementation):
- Fungibility: Strict (Wallet), Versioned (Workspace), Transient (Network)
- Topology: Values (Wallet), Objects (Workspace), Subjects (Tenant), Links (Network)
- Permeability: Sealed (Wallet), Gated (Tenant), Collaborative (Room), Open (Network)
- Execution: Disabled (Wallet), Sandboxed (Workspace), Full (Tenant)

The beauty: Same code, different physics. A Room and a Workspace use the same Container primitive; the difference is in the Agreement that governs them.

0.3 Event Sourcing: State is Derived, Never Stored

**The principle:** Never store "current state". Always store events. Reconstruct state by replaying events.

**How it works:** All state is reconstructed by replaying events:
- Current room state = replay all message events
- Current tenant state = replay all membership/room creation events
- Current ledger state = replay all action/effect atoms

This means:
- Perfect audit trail (every change is an event)
- Time travel (reconstruct any point in time)
- No data loss (events are append-only)
- Verifiable integrity (hash chain prevents tampering)

0.4 The Universal Transfer

**The principle:** One operation (`transfer`) works for everything. The "physics" of the source Container determines behavior.

**How it works:** One operation to rule them all:
- Send message = Transfer Message from User to Room Container
- Create document = Transfer Document from User to Workspace Container
- Join tenant = Transfer Membership Agreement from System to Tenant Container

The physics of the source container determines behavior:
- Strict (Wallet): Item moves. Source decreases.
- Versioned (Workspace): Item copies. Source remains.
- Transient (Network): Item flows through. Nothing persists.

1) The stack in one sentence
UBL Messenger is the OS UI and receipt timeline; Cloudflare Zero Trust + MCP Portals are the governable tool marketplace; Durable Objects are the linearizable room/repo ledgers; Workflows/Queues run execution; Containers/Sandbox run untrusted code; AI Gateway + Firewall for AI harden model I/O.

**What this means:**
- **UBL Messenger**: The user interface (PWA) and the timeline of receipts (what happened, when, under which Agreement)
- **Cloudflare Zero Trust + MCP Portals**: Identity/policy enforcement + tool marketplace with governance
- **Durable Objects**: The ordered state (chat timelines, ledger shards) — one instance globally, strongly consistent
- **Workflows/Queues**: Long-running jobs with retries and approvals
- **Containers/Sandbox**: Safe execution of untrusted code
- **AI Gateway + Firewall**: LLM calls go through a hardened perimeter (caching, rate limiting, PII detection)

Key Cloudflare primitives you're explicitly betting on (all real products today):
**MCP Server Portals**: Centralize many MCP servers under one URL, curated tools/prompts, and log each tool request in Access logs. This is Cloudflare's tool marketplace — instead of exposing 50 different tool URLs, you expose one portal URL. 


**Streamable HTTP**: The standard remote MCP transport; your MCP server must support GET+POST on a single endpoint (e.g., `/mcp`) and validate Origin header to prevent DNS rebinding attacks. 


**Durable Objects**: Give you "one object instance globally" + strongly consistent transactional storage (ideal for strict ordering). Perfect for chat rooms (ordered message sequence) and ledger shards (append-only with hash chain). 


**Workflows**: Durable multi-step jobs with retries + ability to pause for approvals (exactly your mini-contract semantics). Later, you'll use this for PROPOSE → APPROVE → EXECUTE → SETTLE flows. 


Queues provide async processing + event subscriptions across CF products (R2, Workers AI, etc.). 


Containers run full isolated workloads, orchestrated from Workers. 


Sandbox SDK = Workers + Durable Objects + Containers for safe untrusted code execution. 


AI Gateway provides caching, rate limiting, logs, fallback, provider routing. 


Firewall for AI detects PII, unsafe topics, prompt injection on JSON prompts and exposes rule fields (e.g. cf.llm.prompt.pii_detected). 


Access service tokens let automated services/bots authenticate to Access-protected apps using CF-Access-Client-Id/Secret. 


Workers for Platforms “untrusted mode” gives isolation for user/AI-generated code if you ever expose “hosted scripts.” 



2) Product-level architecture
2.1 Domains (simple and clean)
ubl.yourdomain.com → PWA + API (human UI)


mcp.yourdomain.com → Cloudflare MCP Portal URL (the only MCP URL you distribute)


api.ubl.yourdomain.com (optional) → same Worker, separate hostname if you prefer


The point: humans and agents never need to know 50 tool URLs. They know the portal URL. 

2.2 The “Cloudflare-only computer” runtime
Everything runs as:
Workers (gw, connectors, tool servers)


Durable Objects (ordered state + governance)


Workflows + Queues (durable execution)


R2 (blobs/archives)


Containers/Sandbox (untrusted execution)


AI Gateway + Firewall for AI (model perimeter)


Access (identity gate for humans + bots)



3) UBL as a tenant of itself (no privileged backdoor)
Tenant 0: 
UBL_CORE
Hosts platform governance rooms (#platform-ops, #security-audit, #key-ceremony, etc.)


Manages tool registry and connector approvals using the same messenger + receipts


Any “admin” action is just another receipted action in the ledger.


Customer tenants
Same model: rooms, tool policies, receipts, optional E2EE rooms later


No special-case runtime


This keeps the constitution honest: if tenant 0 can do it, it’s because the platform rules allow it — and it leaves receipts.

4) The three planes (and how Cloudflare maps perfectly)
4.1 Control plane (policy + identity)
Cloudflare Zero Trust:
Access gates UI/API/MCP; identity is the “who” in receipts.


Service tokens authenticate bots/services to the same Access policies. 


(Optional) Gateway controls egress when agents start calling the internet.


4.2 Data plane (ordered state + archives)
RoomObject DO: strict room ordering (chat timeline, proposals later)


LedgerShard DO: append-only receipts with hash chaining


R2: archives, attachments, NDJSON snapshots, artifacts


Durable Objects are the “single writer / ordered truth” substrate. 
4.3 Execution plane (tools + jobs + sandbox)
Workers run tool handlers fast.


Workflows run long, durable multi-step actions and can pause for approvals. 


Queues offload and subscribe to platform events. 


Sandbox SDK runs untrusted code in isolated Linux containers, managed by a DO. 


Containers are the underlying isolated runtime. 



5) MCP is your tool bus (host your tools + consume others)
5.1 The golden rule
You never expose “random MCP servers” directly to users.
You expose one thing: MCP Server Portal URL.
Cloudflare MCP portals:
aggregate multiple MCP servers under one endpoint


let admins curate tools/prompts (least privilege)


authenticate users via Access


log tool calls in Access logs (capability-level observability). 


5.2 Hosting your own tools/services on Cloudflare
You will implement your own MCP server(s) as Workers:
ubl-messenger-mcp (core)


ubl-office-mcp (Office as MCP Server + Client)


ubl-repo-mcp (git-like content-addressed repo later)


ubl-sandbox-mcp (exec later)


ubl-ai-mcp (model calls via AI Gateway later)


All behind Access, all receipted, all portal-curated.

5.2.1 Office as MCP Server + Client (MVP-1)
Office is both an MCP server (exposes tools) and an MCP client (consumes other tools):

Office MCP Server:
- Exposes office.* tools (document.create, document.get, document.search, llm.complete)
- Runs as Worker at /mcp endpoint (same endpoint as messenger.* tools, or separate /office/mcp)
- All tool calls emit action.v1 + effect.v1 to LedgerShard
- References WorkspaceAgreement in action.v1.agreement_id (Agreement-first)
- Integrates with UBL: every document operation is a receipted action

Office MCP Client:
- Can consume other MCP servers via portal
- Uses MCP Registry to discover tools
- Can call messenger.* tools, external tools, etc.
- All client calls also emit receipts

The integration:
- Office creates a document → emits action.v1 to LedgerShard
- Office calls messenger.send via MCP → emits action.v1 to LedgerShard
- Office calls external tool via MCP → emits action.v1 to LedgerShard
- All receipts link via hash chain

This makes Office the "universal tool orchestrator" while keeping everything receipted in UBL.
5.3 Consuming other people’s tools
You add external MCP servers into the portal:
unauthenticated servers supported


OAuth-secured servers supported (user prompted per-server)


Access policies control who sees what servers and tools. 


The result: you get a Cloudflare-native “tool marketplace” with governance and logs.

6) Streaming design (MCP streaming + messenger streaming)
6.1 MCP streaming (Streamable HTTP)
Your MCP endpoint must:
be a single path (e.g. /mcp) supporting GET and POST


optionally use SSE to stream server messages


validate Origin header to prevent DNS rebinding attacks (403 if invalid). 


Cloudflare’s Agents docs align: Streamable HTTP is the recommended remote transport; SSE is legacy. 
6.2 Messenger streaming (SSE for iPhone)
Your iPhone PWA should use:
REST for actions (POST /api/rooms/:id/messages to send)


SSE for room events (best mobile reliability)
- Why SSE over WebSocket? Better reconnection handling on mobile networks
- Client reconnects with `?from_seq=<last_id>` to catch up


Room events:
message.created


message.updated


(later) proposal.state, workflow.progress, tool.stream.chunk



7) AI perimeter (model I/O is treated like an untrusted subprocess)
7.1 AI Gateway (mandatory for any model calls)
Route all model traffic through AI Gateway to get:
caching 


rate limiting 


persistent logs/pricing constraints 


provider routing/fallback (documented in overview/features). 


This becomes the “LLM flight recorder” feeding receipts.
7.2 Firewall for AI (mandatory if you expose prompt endpoints)
Firewall for AI can:
detect PII leakage attempts


detect unsafe topics


detect prompt injection likelihood


expose fields like cf.llm.prompt.pii_detected, cf.llm.prompt.injection_score in rules. 


Example mitigation pattern is explicitly supported (block when cf.llm.prompt.pii_detected). 

8) Execution hardening (your “agent code sandbox” story)
When a tool needs real compute (python, git, build systems, scrapers, etc.), you do not stretch Workers isolates.
You use:
Sandbox SDK (DO identity + container runtime) 


backed by Containers 


If you later host “user/AI-written scripts as products,” you add:
Workers for Platforms in “untrusted mode” for strong per-tenant isolation. 



9) The core UBL object model (dense but implementable)
9.1 Durable Objects
TenantObject(tenant_id)

 membership (Agreements), roles (Agreements), room directory, policy defaults


RoomObject(room_id)

 ordered chat timeline, membership checks (Agreements), SSE subscriber fanout


LedgerShardObject(shard_id)

 append-only receipt atoms + hash chain head


ContainerObject(container_id) [NEW in MVP-1.1]

 unified container primitive (Room, Workspace, Wallet all use this)
 physics (fungibility, topology, permeability, execution)
 governance Agreement reference


(later) ToolRegistryObject

 tool metadata, risk tags, policy constraints


(later) KeyDirectoryObject

 E2EE metadata (public keys + encrypted envelopes)


9.2 Receipt atoms (always)
Every action yields at minimum:
action.v1: who/did/this/when/status/trace


effect.v1: outcome + pointers (room_seq, msg_id, artifacts, etc.)


Ledger returns:
seq, cid, head_hash


This is the bridge to your LogLine tuple worldview: Cloudflare enforces identity/policy; UBL records the consequence as a signed/hashed receipt.

9.3 Agreements in Receipts (the poetry made concrete)
Every receipt can reference an Agreement:
action.v1.agreement_id (optional but recommended)
- References the Agreement that authorized this action
- Links to ContainerGovernance Agreement (for room/workspace operations)
- Links to ToolAccess Agreement (for MCP tool calls)
- Links to WorkflowApproval Agreement (for workflow steps)

This makes the ledger not just a log, but a proof of relationships:
- "User X sent message Y in Room Z" → authorized by RoomMembership Agreement #123
- "User X created document D in Workspace W" → authorized by WorkspaceAgreement #456
- "MCP tool T was called" → authorized by ToolAccess Agreement #789

The Agreement is the "why" behind every "what". Without an Agreement, there is no authorization. Without authorization, there is no action.

10) MVP ladder (so you use “all the new products” without bloating MVP-1)
MVP-1 (Messenger kernel + Office MCP + MCP portal integration)
Ship:
PWA + REST + SSE


Tenant/Room/Ledger DOs


/mcp server exposing messenger.* tools


Office MCP Server + Client (integrated with UBL)


MCP Portal URL working and logging tool calls


Why it already uses “new Cloudflare”:
MCP portal governance + logs 


Streamable HTTP MCP compliance 


Durable Objects strict ordering 


Access identity + service tokens scaffolding


Agreement-first philosophy (every action references an Agreement)


Container primitive (Rooms are Containers, governed by Agreements) 


MVP-2 (Mini-contract FSM + Workflows)
Add:
propose/approve/settle in RoomObject


Workflows for EXECUTE + ability to pause for approvals 


MVP-3 (E2EE rooms)
Add:
per-room encryption envelopes (server never sees plaintext)


KeyDirectory DO


MVP-4 (External tool consumption)
Add:
connectors (MCP-to-MCP, API wrappers)


portal becomes your curated tool marketplace


MVP-5 (Sandbox + Containers)
Add:
sandbox.run tool calling Sandbox SDK 


artifacts to R2


MVP-6 (AI perimeter)
Add:
AI Gateway for all model calls 


Firewall for AI in front of prompt endpoints 


MVP-7 (Evented automation)
Add:
Queues event subscriptions for reactive governance and automation 



11) Implementation contract for MVP-1 (what you actually build first)
11.1 Worker routes
/ui/* → PWA assets


/api/rooms (list/create)


/api/rooms/:id/messages (send)


/api/rooms/:id/history (paging)


/api/events/rooms/:id (SSE stream)


/api/receipts/:seq (lookup)


/mcp (Streamable HTTP: GET+POST) — Messenger + Office tools


/office/mcp (optional; Office-specific MCP endpoint if you want separation)


11.2 MCP tools (v1)
Messenger tools:
messenger.list_rooms


messenger.send


messenger.history


messenger.stream_room (optional; map to SSE semantics)

Office tools (MVP-1):
office.document.create


office.document.get


office.document.search


office.llm.complete (via AI Gateway, emits receipt)


All Office tools (MVP-1):
- Emit action.v1 + effect.v1 to LedgerShard (same flow as messenger.send)
- Reference WorkspaceAgreement in action.v1.agreement_id (Agreement-first)
- Return receipts in response (same shape as messenger tools: {seq, cid, head_hash})
- For office.llm.complete: route through AI Gateway, emit receipt for the LLM call

Note: Office tools operate on Workspaces (Containers), not Rooms. A Workspace is a Container that holds Documents, governed by a WorkspaceAgreement.


11.3 Cloudflare Zero Trust config (must be part of “done”)
Access app protecting UI/API/MCP


MCP Server Portal created; your /mcp server added; logs visible 


Service token created for bots (even if unused yet) 



12) “Proof of Done” for the 
final blueprint direction
 (not just MVP-1)
You’ll know the whole architecture is landing when:
One MCP Portal URL is enough to connect your agent client and see curated tools, and Access logs show tool-level activity. 


Messenger actions create receipts in a ledger DO (seq + hash chain head).


You can add an external MCP server to the portal and see it appear without changing the client config. 


A Workflow can run for minutes/hours and pause for approvals (when you reach MVP-2). 


A Sandbox can execute untrusted code in a container under a DO identity (when you reach MVP-5). 


Model calls go through AI Gateway and prompt endpoints are protected by Firewall for AI rules (when you reach MVP-6). 



If you want the true “final-final” deliverable next, I can write the MVP-1 implementation sheet in one shot (exact DO storage keys, event formats, MCP JSON-RPC shapes, and the receipts canonicalization rules) — but the blueprint above is now the single coherent architecture that uses Cloudflare’s newest toolchain as the carrier for your LogLine/UBL worldview.

—-


Awesome — here’s the MVP-1 Implementation Sheet (dense + unambiguous). This is the “build it exactly like this” spec: routes, DO storage keys, SSE framing, MCP JSON-RPC shapes, and canonical receipt rules.

MVP-1 Implementation Sheet
Goal
Ship the UBL Messenger Kernel on Cloudflare with:
Multi-tenant (simple deterministic v1)


Rooms + ordered messages (room_seq)


Realtime streaming to iPhone via SSE


Every message produces a receipt in an append-only LedgerShard DO


Exposed as REST + SSE for iPhone and MCP for agents/integrations


Ready for MCP Portal fronting (tool curation/logging), without changing your server later



1) Public surface
1.1 REST + SSE (for iPhone PWA)
Base: https://ubl.<domain>
Endpoints
GET /api/whoami


GET /api/rooms


POST /api/rooms


GET /api/rooms/:roomId/history?cursor=&limit=


POST /api/rooms/:roomId/messages


GET /api/events/rooms/:roomId?from_seq=


GET /api/receipts/:seq


All responses must include:
request_id (unique per request)


server_time ISO string



1.2 MCP (for tools/agents)
Base: https://ubl.<domain>
Endpoint
POST /mcp


GET /mcp?session_id=... (SSE channel for server messages; MVP-1 can be keepalive-only, but it must exist)


Important: /mcp is not “your portal URL”. Your portal URL points to this server.

2) Identity + tenant mapping (MVP-1, deterministic)
2.1 Identity record (normalized by gateway)
From Access JWT, normalize into:
{
  "user_id": "u:<stable-sub>",
  "email": "user@domain.com",
  "email_domain": "domain.com",
  "groups": ["...optional..."],
  "is_service": false
}
2.2 Tenant resolution rule (v1)
Use deterministic tenant IDs:
tenant_id = "t:" + email_domain


override for platform ops user(s): tenant_id = "t:ubl_core"


No invites yet. If a user hits the system and their tenant doesn’t exist → auto-create tenant and make them owner.

3) Durable Objects (DOs) and their storage keys
You will deploy exactly 3 DO classes in MVP-1:
TenantObject(tenant_id)


RoomObject(tenant_id, room_id)


LedgerShardObject(tenant_id, shard_id) → shard_id fixed to "0" in MVP-1


3.1 TenantObject — storage keys
tenant → JSON blob (Tenant record)


rooms → JSON blob (array of room summaries)


Tenant record schema (v1)
{
  "tenant_id": "t:ubl_core",
  "type": "platform",
  "created_at": "2026-01-07T00:00:00.000Z",
  "members": {
    "u:abc": {"role": "owner", "email": "dan@x.com"}
  },
  "defaults": {
    "room_mode": "internal",
    "retention_days": 30,
    "max_message_bytes": 8000
  }
}
Room summary schema (v1)
{"room_id":"r:general","name":"general","mode":"internal","created_at":"..."}
TenantObject methods (internal)
ensureTenantAndMember(identity) -> {tenant, role}


listRooms() -> room_summaries[]


createRoom({name}, identity) -> room_summary



3.2 RoomObject — storage keys
config → JSON blob (Room config)


seq → integer (room_seq)


hot → JSON blob (array of messages; bounded)


seen → JSON blob (optional dedupe map: request_id → msg_id)


In-memory only:
subscribers → list of SSE streams attached (do not persist)


Room config schema (v1)
{
  "tenant_id":"t:ubl_core",
  "room_id":"r:general",
  "name":"general",
  "mode":"internal",
  "created_at":"...",
  "members": {"u:abc":{"role":"owner"},"u:def":{"role":"member"}},
  "policy": {"max_message_bytes":8000,"retention_days":30},
  "hot_limit": 500
}
Message schema (v1)
{
  "msg_id":"m:<uuid>",
  "tenant_id":"t:ubl_core",
  "room_id":"r:general",
  "room_seq":42,
  "sender_id":"u:abc",
  "sent_at":"2026-01-07T12:34:56.789Z",
  "type":"text",
  "body":{"text":"hello"},
  "reply_to":null,
  "attachments":[],
  "receipt":{"ledger_shard":"0","seq":1042,"cid":"c:...","head_hash":"h:..."}
}
RoomObject methods (internal)
assertMember(identity)


sendMessage({type, body, reply_to, request_id}, identity) -> message


getHistory({cursor, limit}, identity) -> {messages, next_cursor}


subscribeSSE(identity) -> stream_handle


broadcast(event) (to all subscribers)


Ordering rule: room_seq increments by exactly 1 per accepted message.
Hot log bound: keep last hot_limit messages, drop oldest.

3.3 LedgerShardObject — storage keys
seq → integer


head → string (head_hash)


hot → JSON blob (array of atoms; bounded)


dedupe → JSON blob (map cid → seq) (optional in MVP-1; recommended)


Ledger atom schema (v1)
You store atoms in an array; each atom contains cid.
action.v1
{
  "kind":"action.v1",
  "tenant_id":"t:ubl_core",
  "cid":"c:...",
  "prev_hash":"h:...",
  "when":"...",
  "who":{"user_id":"u:abc","email":"dan@x.com"},
  "did":"messenger.send",  // MUST match tool name exactly (for portal log correlation)
  "this":{"room_id":"r:general","msg_id":"m:...","room_seq":42,"body_hash":"b:..."},
  "status":"executed",
  "trace":{"request_id":"req:..."}  // MUST propagate to REST/MCP responses and Access logs
}
effect.v1
{
  "kind":"effect.v1",
  "tenant_id":"t:ubl_core",
  "cid":"c:...",
  "ref_action_cid":"c:...",
  "when":"...",
  "outcome":"ok",
  "effects":[{"op":"room.append","room_id":"r:general","room_seq":42}],
  "pointers":{"msg_id":"m:..."}
}
LedgerShardObject methods (internal)
appendAtom(atom_no_cid) -> receipt


getBySeq(seq) -> atoms[] (return action+effect pair when applicable)


queryRecent({cursor, limit}) -> {atoms, next_cursor}


Hot atoms bound: 2000 atoms (so ~1000 messages if you always store action+effect).

4) Canonicalization + hashing (receipt rules)
MVP-1 canonical rules must be deterministic across Workers.
4.1 Canonical JSON (v1)
Use a strict canonical serialization for hashing:
UTF-8


Object keys sorted lexicographically


No insignificant whitespace


Numbers must be rendered consistently (recommend: stringify with minimal representation; avoid 1.0 vs 1 differences)


(You can swap in full JSON✯Atomic later; MVP-1 just needs a stable hash.)
4.2 Hashes
Use these 3 hashes:
body_hash

 body_hash = SHA256(canonical_json(message.body))


cid for an atom

 cid = SHA256(canonical_json(atom_without_cid))

 (Do not include cid inside itself.)


head_hash chain

 head_hash = SHA256(prev_head_hash + ":" + cid)


For the first atom: prev_head_hash = "h:genesis"


4.3 Receipt object returned by ledger
{
  "ledger_shard":"0",
  "seq": 1042,
  "cid":"c:...",
  "head_hash":"h:...",
  "time":"2026-01-07T12:34:56.790Z"
}

5) Exact “send message” transaction (authoritative flow)
When POST /api/rooms/:roomId/messages arrives:
gw normalizes identity + resolves tenant_id


TenantObject.ensureTenantAndMember(identity)


RoomObject.assertMember(identity)


RoomObject:


validates size (max_message_bytes)


increments room_seq


builds message skeleton (no receipt yet)


RoomObject builds action.v1 atom (without cid), includes body_hash


RoomObject calls LedgerShardObject.appendAtom(action)


RoomObject builds effect.v1 atom referencing the action cid


RoomObject calls LedgerShardObject.appendAtom(effect)


RoomObject attaches the action receipt (or the later effect receipt—your choice; I recommend action receipt) to the message


RoomObject stores message in hot


RoomObject broadcasts SSE message.created


gw returns message JSON


Idempotency (recommended even in MVP-1):
If the request repeats with the same request_id, RoomObject should return the already-created msg_id from seen.

6) REST endpoint contracts (exact)
6.1 
GET /api/whoami
{
  "identity":{"user_id":"u:abc","email":"dan@x.com"},
  "tenant_id":"t:ubl_core",
  "role":"owner",
  "request_id":"req:...",
  "server_time":"..."
}
6.2 
GET /api/rooms
{
  "rooms":[{"room_id":"r:general","name":"general","mode":"internal"}],
  "request_id":"req:...",
  "server_time":"..."
}
6.3 
POST /api/rooms
Request:
{"name":"general"}
Response:
{"room_id":"r:general","request_id":"req:...","server_time":"..."}
6.4 
GET /api/rooms/:roomId/history
Rules:
limit default 50 max 200


cursor means “return messages with room_seq < cursor”


if no cursor, start from current seq+1


Response:
{
  "messages":[...],
  "next_cursor": 42,
  "request_id":"req:...",
  "server_time":"..."
}
6.5 
POST /api/rooms/:roomId/messages
Request:
{"type":"text","body":{"text":"hello"},"reply_to":null}
Response:
{"message":{...},"request_id":"req:...","server_time":"..."}
6.6 
GET /api/events/rooms/:roomId
 (SSE)
Query:
from_seq optional; if present, server may replay from hot log (best effort)


SSE framing (exact)
Each event uses:


id: <room_seq> (so clients can resume)


event: message.created


data: <single-line JSON>


Example:
id: 42
event: message.created
data: {"room_id":"r:general","message":{...}}
Keepalive:
Every 15s:


:keepalive
Client reconnect strategy:
store last received id (= room_seq)


reconnect with ?from_seq=<last_id>



6.7 
GET /api/receipts/:seq
Response:
{
  "seq":1042,
  "atoms":[{"kind":"action.v1",...},{"kind":"effect.v1",...}],
  "request_id":"req:...",
  "server_time":"..."
}

7) MCP (JSON-RPC) contracts (exact)
7.1 POST /mcp — request/response envelope
All requests are JSON-RPC 2.0.
initialize
Request:
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"client":{"name":"ubl-client","version":"0.1"}}}
Response:
{
  "jsonrpc":"2.0",
  "id":1,
  "result":{
    "serverInfo":{"name":"ubl-messenger","version":"0.1"},
    "capabilities":{"tools":true,"streaming":true},
    "session_id":"s:<uuid>"
  }
}
tools/list
Request:
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"session_id":"s:..."}}
Response:
{
  "jsonrpc":"2.0",
  "id":2,
  "result":{
    "tools":[
      {"name":"messenger.list_rooms","inputSchema":{...}},
      {"name":"messenger.send","inputSchema":{...}},
      {"name":"messenger.history","inputSchema":{...}}
    ]
  }
}
tools/call
Request:
{
  "jsonrpc":"2.0",
  "id":3,
  "method":"tools/call",
  "params":{
    "session_id":"s:...",
    "name":"messenger.send",
    "arguments":{"room_id":"r:general","type":"text","body":{"text":"hello"}}
  }
}
Response:
{
  "jsonrpc":"2.0",
  "id":3,
  "result":{
    "content":[{"type":"json","json":{"msg_id":"m:...","room_seq":42,"receipt":{"seq":1042,"cid":"c:...","head_hash":"h:..."}}}]
  }
}
7.2 GET /mcp?session_id=… (SSE server channel)
MVP-1 behavior:
Accept GET and keep it open


Emit keepalive comments every 15s


Optionally emit event: server.notice once on connect


Later you will use this channel to stream tool output and push notifications (approvals, workflow progress, etc.). MVP-1 just needs the channel present so you don’t redesign later.

8) “Done” definition for MVP-1 (strict)
You are done when these are true:
POST /api/rooms creates a room, shows in GET /api/rooms.


POST /api/rooms/:id/messages returns a message with:


room_seq


receipt.seq, receipt.cid, receipt.head_hash


GET /api/events/rooms/:id streams message.created with id == room_seq.


GET /api/receipts/:seq returns the stored atoms for that message.


POST /mcp supports initialize, tools/list, tools/call(messenger.* and office.*) and returns the same receipt semantics as REST.

Office MCP Client can consume messenger.* tools and external tools via portal, all receipted.



8.5) Two Cloudflare realities to bake in now (so you don't get surprised later)

**1) Portal policies don't magically protect your server's direct URL**

Cloudflare explicitly warns that users blocked in portal policies can still hit the MCP server directly if they know the direct MCP server URL—unless you configure Access as the server's OAuth provider / enforce auth at the server.

**MVP-1 posture (simple + honest):**
- Treat the portal URL as the only "official" URL you hand to clients.
- Still protect your own `/mcp` with Access (good).
- Accept that someone with the direct URL might bypass "portal curation" unless you go deeper on OAuth enforcement.

That's not a flaw in your UBL design — it's just how portals work.

**2) Portal expects "portal session" semantics; Cloudflare recommends mcp-remote**

Cloudflare's portal doc recommends using `mcp-remote@latest` and explicitly says don't rely on `serverURL` in some client configs because it can break portal session creation/management.

So your "one MCP URL" story should include this operational detail:
- **"Use the portal URL via `mcp-remote@latest`."**

**Transport sanity check: your MCP endpoint design matches current guidance**

Cloudflare's Agents docs call out Streamable HTTP as the recommended remote MCP transport and note SSE as deprecated in MCP spec terms.

So your contract of:
- `POST /mcp` for JSON-RPC
- `GET /mcp?...` for the server stream channel (even if it's keepalive-only in MVP-1)

…is a good future-lock.

9) MVP-1 Day-0 Setup Checklist (single measurable deliverable)

**Deliverable:** You can connect an MCP client to your portal URL, see your tools, call `messenger.send`, and then see a portal log entry with the tool ("Capability").

**A) Cloudflare prerequisites (must be true)**
- Your domain is on Cloudflare (full or CNAME setup is acceptable per portal prereqs).
- Zero Trust is enabled and you have an IdP configured.

**B) Deploy your MCP server (your Worker)**
- Deploy your Worker somewhere stable (your blueprint's "single worker MVP-1" is fine).
- Ensure your Worker exposes `/mcp` and returns:
  - `initialize`
  - `tools/list`
  - `tools/call`
- Add Origin validation for browser-based clients (and keep an allowlist that includes your UI origin + the portal flow you expect).

(Your REST+SSE messenger can be deployed at the same host; doesn't matter for this checklist.)

**C) Add your Worker as an MCP server inside Cloudflare One**

In Cloudflare One:
- Go to **Access controls → AI controls → MCP servers**
- Add an MCP server
- Set HTTP URL to your Worker's MCP endpoint (the direct `/mcp` URL).
- Attach an Allow policy so you (your identity) can see it in portals.
- Confirm server status reaches **Ready** (sync happens automatically; Cloudflare also notes a 24h auto-sync cadence with manual sync available).

**D) Create the MCP Portal (your "single URL")**

In Cloudflare One:
- **Access controls → AI controls → Add MCP server portal**
- Choose a custom domain/subdomain
- Add your MCP server into that portal
- Add an Allow policy for who can connect
- Your portal URL will be: `https://<subdomain>.<domain>/mcp`

**E) Prove logs work (this is the "Cloudflare is my computer" moment)**
- Connect using an MCP client (Cloudflare mentions Workers AI Playground / MCP Inspector / other remote clients).
- Make a tool call (e.g., `messenger.send`)
- In Cloudflare One, open **Portal logs**
- You should see fields including **Server** and **Capability** (tool name), plus duration and status.

**Proof of Done (strict):**
1. Portal URL connects and shows your tool list.
2. Calling `messenger.send` succeeds.
3. Portal logs show a row where **Capability = messenger.send**.

**One "don't-skip" implementation detail for your receipts**

When portal logs say **Capability**, that's already a tool-level audit stream.

So your ledger atom should always include:
- `did = <tool name>` exactly (e.g., `messenger.send`)
- `trace.request_id` that you also propagate to:
  - REST responses
  - MCP responses
  - (later) Access logs correlation

That's how you get the "triple-entry bookkeeping" vibe: **Portal log ↔ receipt ↔ room timeline**.

10) What to configure in Cloudflare alongside MVP-1 (so you're "using the new products")
Do these in parallel with MVP-1 deployment:
Access app protecting /ui/*, /api/*, /mcp


Create an MCP Server Portal and attach your MCP server (your /mcp) so the portal URL becomes the canonical MCP entrypoint for clients. **Use `mcp-remote@latest` to connect to the portal URL.**


Ensure portal logs show capability/tool call activity (even if you're the only user initially).


(Everything else—Workflows/Queues/Sandbox/AI Gateway/Firewall for AI—plugs in cleanly after MVP-1 without changing these contracts.)

Below are the strict JSON Schemas for the MVP-1 MCP tools, plus the standardized result shape (so REST and MCP stay isomorphic). No fluff, just the exact contracts.

1) Tool: 
messenger.list_rooms
Input schema
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "cursor": {
      "type": ["string", "null"],
      "description": "Optional cursor for pagination. MVP-1 may ignore and return all."
    },
    "limit": {
      "type": ["integer", "null"],
      "minimum": 1,
      "maximum": 500,
      "description": "Optional limit. MVP-1 may ignore."
    }
  }
}
Result schema (JSON payload inside MCP content)
{
  "type": "object",
  "additionalProperties": false,
  "required": ["rooms"],
  "properties": {
    "rooms": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["room_id", "name", "mode"],
        "properties": {
          "room_id": {"type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$"},
          "name": {"type": "string", "minLength": 1, "maxLength": 128},
          "mode": {"type": "string", "enum": ["internal"]},
          "created_at": {"type": ["string", "null"], "description": "ISO time", "format": "date-time"}
        }
      }
    },
    "next_cursor": {"type": ["string", "null"]}
  }
}

2) Tool: 
messenger.send
Input schema
{
  "type": "object",
  "additionalProperties": false,
  "required": ["room_id", "type", "body"],
  "properties": {
    "room_id": {
      "type": "string",
      "pattern": "^r:[A-Za-z0-9._-]{1,128}$"
    },
    "type": {
      "type": "string",
      "enum": ["text", "system"]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "required": ["text"],
      "properties": {
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 8000,
          "description": "Plaintext message content (MVP-1 internal-mode only)."
        }
      }
    },
    "reply_to": {
      "type": ["string", "null"],
      "pattern": "^m:[A-Za-z0-9._-]{1,256}$",
      "description": "Optional msg_id to reply to."
    },
    "client_request_id": {
      "type": ["string", "null"],
      "maxLength": 128,
      "description": "Optional idempotency key. If absent, server may generate one."
    }
  }
}
Result schema (returns full message object)
{
  "type": "object",
  "additionalProperties": false,
  "required": ["message"],
  "properties": {
    "message": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "msg_id",
        "tenant_id",
        "room_id",
        "room_seq",
        "sender_id",
        "sent_at",
        "type",
        "body",
        "reply_to",
        "attachments",
        "receipt"
      ],
      "properties": {
        "msg_id": {"type": "string", "pattern": "^m:[A-Za-z0-9._-]{1,256}$"},
        "tenant_id": {"type": "string", "pattern": "^t:[A-Za-z0-9._-]{1,128}$"},
        "room_id": {"type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$"},
        "room_seq": {"type": "integer", "minimum": 1},
        "sender_id": {"type": "string", "pattern": "^u:[A-Za-z0-9._-]{1,256}$"},
        "sent_at": {"type": "string", "format": "date-time"},
        "type": {"type": "string", "enum": ["text", "system"]},
        "body": {
          "type": "object",
          "additionalProperties": false,
          "required": ["text"],
          "properties": {
            "text": {"type": "string", "minLength": 1, "maxLength": 8000}
          }
        },
        "reply_to": {
          "type": ["string", "null"],
          "pattern": "^m:[A-Za-z0-9._-]{1,256}$"
        },
        "attachments": {
          "type": "array",
          "items": {"type": "object"},
          "description": "MVP-1: always empty."
        },
        "receipt": {
          "type": "object",
          "additionalProperties": false,
          "required": ["ledger_shard", "seq", "cid", "head_hash"],
          "properties": {
            "ledger_shard": {"type": "string", "enum": ["0"]},
            "seq": {"type": "integer", "minimum": 1},
            "cid": {"type": "string", "minLength": 10},
            "head_hash": {"type": "string", "minLength": 10},
            "time": {"type": ["string", "null"], "format": "date-time"}
          }
        }
      }
    },
    "request_id": {
      "type": ["string", "null"],
      "description": "Server request id. In REST always present; in MCP optional."
    },
    "server_time": {"type": ["string", "null"], "format": "date-time"}
  }
}

3) Tool: 
messenger.history
Input schema
{
  "type": "object",
  "additionalProperties": false,
  "required": ["room_id"],
  "properties": {
    "room_id": {
      "type": "string",
      "pattern": "^r:[A-Za-z0-9._-]{1,128}$"
    },
    "cursor": {
      "type": ["integer", "null"],
      "minimum": 1,
      "description": "Return messages with room_seq < cursor. If null, start from latest."
    },
    "limit": {
      "type": ["integer", "null"],
      "minimum": 1,
      "maximum": 200,
      "description": "Default 50."
    }
  }
}
Result schema
{
  "type": "object",
  "additionalProperties": false,
  "required": ["messages", "next_cursor"],
  "properties": {
    "messages": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/message"
      }
    },
    "next_cursor": {
      "type": ["integer", "null"],
      "description": "Use as cursor for the next page."
    },
    "request_id": {"type": ["string", "null"]},
    "server_time": {"type": ["string", "null"], "format": "date-time"}
  },
  "$defs": {
    "message": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "msg_id",
        "tenant_id",
        "room_id",
        "room_seq",
        "sender_id",
        "sent_at",
        "type",
        "body",
        "reply_to",
        "attachments",
        "receipt"
      ],
      "properties": {
        "msg_id": {"type": "string", "pattern": "^m:[A-Za-z0-9._-]{1,256}$"},
        "tenant_id": {"type": "string", "pattern": "^t:[A-Za-z0-9._-]{1,128}$"},
        "room_id": {"type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$"},
        "room_seq": {"type": "integer", "minimum": 1},
        "sender_id": {"type": "string", "pattern": "^u:[A-Za-z0-9._-]{1,256}$"},
        "sent_at": {"type": "string", "format": "date-time"},
        "type": {"type": "string", "enum": ["text", "system"]},
        "body": {
          "type": "object",
          "additionalProperties": false,
          "required": ["text"],
          "properties": {
            "text": {"type": "string", "minLength": 1, "maxLength": 8000}
          }
        },
        "reply_to": {
          "type": ["string", "null"],
          "pattern": "^m:[A-Za-z0-9._-]{1,256}$"
        },
        "attachments": {
          "type": "array",
          "items": {"type": "object"}
        },
        "receipt": {
          "type": "object",
          "additionalProperties": false,
          "required": ["ledger_shard", "seq", "cid", "head_hash"],
          "properties": {
            "ledger_shard": {"type": "string", "enum": ["0"]},
            "seq": {"type": "integer", "minimum": 1},
            "cid": {"type": "string", "minLength": 10},
            "head_hash": {"type": "string", "minLength": 10},
            "time": {"type": ["string", "null"], "format": "date-time"}
          }
        }
      }
    }
  }
}

4) Optional tool (MVP-1.1): 
messenger.stream_room
If you want to expose streaming via MCP directly (instead of telling MCP clients to use REST SSE), define it like this:
Input schema
{
  "type": "object",
  "additionalProperties": false,
  "required": ["room_id"],
  "properties": {
    "room_id": {"type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$"},
    "from_seq": {"type": ["integer", "null"], "minimum": 1}
  }
}
Result schema
Return an MCP “stream descriptor” (your server will then stream chunks on GET /mcp for that session):
{
  "type": "object",
  "additionalProperties": false,
  "required": ["stream"],
  "properties": {
    "stream": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "room_id"],
      "properties": {
        "kind": {"type": "string", "enum": ["sse"]},
        "room_id": {"type": "string"},
        "from_seq": {"type": ["integer", "null"]}
      }
    }
  }
}

5) How to publish these schemas in 
tools/list
In MCP tools/list, each tool entry should include name and inputSchema (and you can also include a description and outputSchema in metadata if you want—clients vary).
Example tools/list excerpt:
{
  "tools": [
    {
      "name": "messenger.send",
      "description": "Append a plaintext message to a room (internal mode). Returns the full message with receipt.",
      "inputSchema": { ...schema above... }
    }
  ]
}

Perfect — here are the strict JSON Schemas for:
SSE event payloads (room stream)


Ledger atoms (action.v1, effect.v1)


Receipt lookup response

 …all aligned with MVP-1 and ready to be used both in REST docs and internal validation.



1) SSE stream: event envelope schema
You’re sending SSE frames like:
id: <room_seq>
event: message.created
data: <JSON>
The JSON inside data: must conform to this schema:
{
  "$id": "ubl.sse.room_event.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["event", "room_id", "tenant_id", "ts", "payload"],
  "properties": {
    "event": {
      "type": "string",
      "enum": ["message.created", "room.created", "room.member_joined"]
    },
    "tenant_id": {
      "type": "string",
      "pattern": "^t:[A-Za-z0-9._-]{1,128}$"
    },
    "room_id": {
      "type": "string",
      "pattern": "^r:[A-Za-z0-9._-]{1,128}$"
    },
    "ts": {
      "type": "string",
      "format": "date-time",
      "description": "Server timestamp for the event."
    },
    "payload": {
      "type": "object",
      "description": "Event-specific payload. See $defs."
    }
  },
  "allOf": [
    {
      "if": { "properties": { "event": { "const": "message.created" } } },
      "then": {
        "properties": {
          "payload": { "$ref": "#/$defs/message_created_payload" }
        }
      }
    },
    {
      "if": { "properties": { "event": { "const": "room.created" } } },
      "then": {
        "properties": {
          "payload": { "$ref": "#/$defs/room_created_payload" }
        }
      }
    },
    {
      "if": { "properties": { "event": { "const": "room.member_joined" } } },
      "then": {
        "properties": {
          "payload": { "$ref": "#/$defs/room_member_joined_payload" }
        }
      }
    }
  ],
  "$defs": {
    "message": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "msg_id",
        "tenant_id",
        "room_id",
        "room_seq",
        "sender_id",
        "sent_at",
        "type",
        "body",
        "reply_to",
        "attachments",
        "receipt"
      ],
      "properties": {
        "msg_id": { "type": "string", "pattern": "^m:[A-Za-z0-9._-]{1,256}$" },
        "tenant_id": { "type": "string", "pattern": "^t:[A-Za-z0-9._-]{1,128}$" },
        "room_id": { "type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$" },
        "room_seq": { "type": "integer", "minimum": 1 },
        "sender_id": { "type": "string", "pattern": "^u:[A-Za-z0-9._-]{1,256}$" },
        "sent_at": { "type": "string", "format": "date-time" },
        "type": { "type": "string", "enum": ["text", "system"] },
        "body": {
          "type": "object",
          "additionalProperties": false,
          "required": ["text"],
          "properties": {
            "text": { "type": "string", "minLength": 1, "maxLength": 8000 }
          }
        },
        "reply_to": {
          "type": ["string", "null"],
          "pattern": "^m:[A-Za-z0-9._-]{1,256}$"
        },
        "attachments": {
          "type": "array",
          "items": { "type": "object" },
          "description": "MVP-1: always empty."
        },
        "receipt": { "$ref": "#/$defs/receipt" }
      }
    },
    "receipt": {
      "type": "object",
      "additionalProperties": false,
      "required": ["ledger_shard", "seq", "cid", "head_hash"],
      "properties": {
        "ledger_shard": { "type": "string", "enum": ["0"] },
        "seq": { "type": "integer", "minimum": 1 },
        "cid": { "type": "string", "minLength": 10 },
        "head_hash": { "type": "string", "minLength": 10 },
        "time": { "type": ["string", "null"], "format": "date-time" }
      }
    },
    "message_created_payload": {
      "type": "object",
      "additionalProperties": false,
      "required": ["message"],
      "properties": {
        "message": { "$ref": "#/$defs/message" }
      }
    },
    "room_created_payload": {
      "type": "object",
      "additionalProperties": false,
      "required": ["room_id", "name", "mode", "created_at"],
      "properties": {
        "room_id": { "type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$" },
        "name": { "type": "string", "minLength": 1, "maxLength": 128 },
        "mode": { "type": "string", "enum": ["internal"] },
        "created_at": { "type": "string", "format": "date-time" }
      }
    },
    "room_member_joined_payload": {
      "type": "object",
      "additionalProperties": false,
      "required": ["user_id"],
      "properties": {
        "user_id": { "type": "string", "pattern": "^u:[A-Za-z0-9._-]{1,256}$" },
        "role": { "type": ["string", "null"], "enum": ["owner", "member", null] }
      }
    }
  }
}
SSE framing rule (non-schema but strict): set id: to the message’s room_seq for message.created.

2) Ledger atoms: JSON Schemas
2.1 
action.v1
 atom schema
{
  "$id": "ubl.ledger.action.v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "kind",
    "tenant_id",
    "cid",
    "prev_hash",
    "when",
    "who",
    "did",
    "this",
    "status",
    "trace"
  ],
  "properties": {
    "kind": { "type": "string", "const": "action.v1" },
    "tenant_id": { "type": "string", "pattern": "^t:[A-Za-z0-9._-]{1,128}$" },
    "cid": { "type": "string", "minLength": 10, "description": "Hash of canonical JSON of atom WITHOUT cid." },
    "prev_hash": { "type": "string", "minLength": 10, "description": "Prior ledger head hash (or genesis)." },
    "when": { "type": "string", "format": "date-time" },
    "who": {
      "type": "object",
      "additionalProperties": false,
      "required": ["user_id", "email"],
      "properties": {
        "user_id": { "type": "string", "pattern": "^u:[A-Za-z0-9._-]{1,256}$" },
        "email": { "type": "string", "format": "email" },
        "is_service": { "type": ["boolean", "null"] }
      }
    },
    "did": {
      "type": "string",
      "enum": ["messenger.send", "room.create", "tenant.create", "office.document.create", "office.document.get", "office.document.search", "office.llm.complete"]
    },
    "this": {
      "type": "object",
      "additionalProperties": false,
      "oneOf": [
        {
          "description": "For messenger.* actions",
          "required": ["room_id", "msg_id", "room_seq", "body_hash"],
          "properties": {
            "room_id": { "type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$" },
            "msg_id": { "type": "string", "pattern": "^m:[A-Za-z0-9._-]{1,256}$" },
            "room_seq": { "type": "integer", "minimum": 1 },
            "body_hash": { "type": "string", "minLength": 10 }
          }
        },
        {
          "description": "For office.* actions",
          "required": ["workspace_id", "document_id"],
          "properties": {
            "workspace_id": { "type": "string", "pattern": "^w:[A-Za-z0-9._-]{1,128}$" },
            "document_id": { "type": "string", "pattern": "^d:[A-Za-z0-9._-]{1,256}$" },
            "content_hash": { "type": ["string", "null"], "minLength": 10, "description": "SHA256 of document content (for document.create)" }
          }
        }
      ]
    },
    "agreement_id": {
      "type": ["string", "null"],
      "pattern": "^a:[A-Za-z0-9._-]{1,256}$",
      "description": "References the Agreement that authorized this action (Agreement-first philosophy)"
    },
    "status": { "type": "string", "enum": ["executed"] },
    "trace": {
      "type": "object",
      "additionalProperties": false,
      "required": ["request_id"],
      "properties": {
        "request_id": { "type": "string", "minLength": 6, "maxLength": 128 }
      }
    }
  }
}
Note: For MVP-1, did includes messenger.* and office.* actions. agreement_id is optional but recommended (Agreement-first).

2.2 
effect.v1
 atom schema
{
  "$id": "ubl.ledger.effect.v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "kind",
    "tenant_id",
    "cid",
    "ref_action_cid",
    "when",
    "outcome",
    "effects",
    "pointers"
  ],
  "properties": {
    "kind": { "type": "string", "const": "effect.v1" },
    "tenant_id": { "type": "string", "pattern": "^t:[A-Za-z0-9._-]{1,128}$" },
    "cid": { "type": "string", "minLength": 10, "description": "Hash of canonical JSON of atom WITHOUT cid." },
    "ref_action_cid": { "type": "string", "minLength": 10 },
    "when": { "type": "string", "format": "date-time" },
    "outcome": { "type": "string", "enum": ["ok", "error"] },
    "effects": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["op", "room_id", "room_seq"],
        "properties": {
          "op": { "type": "string", "enum": ["room.append"] },
          "room_id": { "type": "string", "pattern": "^r:[A-Za-z0-9._-]{1,128}$" },
          "room_seq": { "type": "integer", "minimum": 1 }
        }
      }
    },
    "pointers": {
      "type": "object",
      "additionalProperties": false,
      "required": ["msg_id"],
      "properties": {
        "msg_id": { "type": "string", "pattern": "^m:[A-Za-z0-9._-]{1,256}$" }
      }
    },
    "error": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "required": ["code", "message"],
      "properties": {
        "code": { "type": "string", "maxLength": 64 },
        "message": { "type": "string", "maxLength": 500 }
      }
    }
  }
}

3) Receipt lookup response schema (
GET /api/receipts/:seq
)
This endpoint returns the action+effect pair (or any set of atoms at that seq range if you later batch).
{
  "$id": "ubl.api.receipt_lookup.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["seq", "atoms", "request_id", "server_time"],
  "properties": {
    "seq": { "type": "integer", "minimum": 1 },
    "atoms": {
      "type": "array",
      "minItems": 1,
      "items": {
        "anyOf": [
          { "$ref": "ubl.ledger.action.v1" },
          { "$ref": "ubl.ledger.effect.v1" }
        ]
      }
    },
    "request_id": { "type": "string", "minLength": 6, "maxLength": 128 },
    "server_time": { "type": "string", "format": "date-time" }
  }
}
If you can’t do $ref across IDs in your validator, inline the schemas or bundle them in one file under $defs.

4) Canonicalization contract (written as “must” rules)
These aren’t JSON Schema, but they’re part of “spec correctness”:
cid must be computed from the atom object with the cid field omitted.


body_hash = SHA256(canonical_json(message.body))


head_hash = SHA256(prev_head_hash + ":" + cid)


All timestamps are ISO 8601 UTC.


Keys are sorted lexicographically during canonical JSON serialization.


That’s enough to lock determinism in MVP-1.

5) Minimal event list (MVP-1 strict)
message.created → always emitted on successful send


room.created → emitted when room is created


room.member_joined → optional (emit when auto-add happens)


Everything else waits for MVP-2.


Nice — then you’re in the “start building” zone.
Here’s what you should do next, in the smallest possible sequence, without adding new design:
Next actions (MVP-1 build order)
Implement TenantObject auto-bootstrap


On first request: create tenant + set caller as owner


Create TenantLicense Agreement (Agreement-first)
- Agreement ID: a:tenant:<tenant_id>
- Establishes the tenant and grants owner role to creator


Ensure r:general exists (auto-create)


Create RoomGovernance Agreement for r:general (Agreement-first)
- Agreement ID: a:room:<room_id>
- Establishes room governance and initial membership


Implement RoomObject send + history


seq monotonic


hot bounded array


seen idempotency map keyed by client_request_id


Reference RoomMembership Agreement in action.v1 (Agreement-first)
- When sending message: include agreement_id = a:room:<room_id> (the RoomGovernance Agreement)
- This proves the user is authorized to send messages in that room


Implement LedgerShardObject append


seq counter


head_hash chain


store atoms in hot


return receipt {seq,cid,head_hash}


Wire REST


/api/rooms, /api/rooms/:id/messages, /api/rooms/:id/history, /api/receipts/:seq


Wire SSE


/api/events/rooms/:id


keepalive + id: room_seq


optional replay from hot + room.gap event


Wire MCP (Messenger)


POST /mcp with initialize, tools/list, tools/call


tools: messenger.list_rooms, messenger.send, messenger.history


return the same message shape as REST


Wire MCP (Office)


Add office.* tools to /mcp (or separate /office/mcp)


office.document.create, office.document.get, office.document.search, office.llm.complete


All office tools emit action.v1 + effect.v1 to LedgerShard


Reference WorkspaceAgreement in action.v1.agreement_id
- When creating document: include agreement_id = a:workspace:<workspace_id>
- This proves the user is authorized to create documents in that workspace
- WorkspaceAgreement is created when workspace is first created (similar to RoomGovernance)


Office MCP Client integration


Office can call messenger.* tools via MCP


Office can call external tools via portal


All client calls emit receipts


Turn on Access + Portal


Protect /ui, /api, /mcp


Create MCP Portal pointing to your /mcp


Add Office MCP server to portal


One invariant to keep in your head
RoomObject is the ordering authority; LedgerShard is the receipt authority.
Room assigns room_seq; ledger assigns seq/head_hash. Message must contain both.

The Agreement-first invariant:
Every action.v1 should reference an agreement_id (the Agreement that authorized it).
- For messenger.send: reference RoomMembership Agreement
- For office.document.create: reference WorkspaceAgreement
- For MCP tool calls: reference ToolAccess Agreement
For MVP-1, agreement_id is optional but recommended. For MVP-2+, it becomes mandatory.

The Container primitive invariant:
Rooms, Workspaces, Wallets — all are Containers with different physics.
- Room: Versioned, Collaborative, Gated (holds Messages)
- Workspace: Versioned, Collaborative, Gated (holds Documents)
- Wallet: Strict, Sealed, Disabled (holds Credits)
The physics come from the ContainerGovernance Agreement (RoomGovernance, WorkspaceAgreement, WalletAgreement), not from the code.
If you want, tell me which part you’re starting with (TenantObject / RoomObject / Ledger) and I’ll give you the “gotchas checklist” for just that part (still in chat, no code unless you ask).
Alright — I’ll keep pushing forward and “close the loop” so you have the full MVP-1 spec as a buildable system, including the missing operational details: routing, DO naming, state limits, correlation IDs, security checks, portal posture, and the exact test plan you can run from your iPhone and from an MCP client.

9) Routing + object addressing (how the gateway finds the right DO)
You want deterministic, boring routing. Here’s the rule set:
9.1 Tenant DO id
tenant_id is a string like t:ubl_core or t:example.com


DO id for TenantObject: TenantObject.idFromName(tenant_id)


9.2 Room DO id
A room’s global identity must include tenant, so:
room_key = tenant_id + "|" + room_id


DO id: RoomObject.idFromName(room_key)


Room IDs should be stable:
room_id = "r:" + slug(name) for standard rooms


DMs later can be r:dm:<hash(userA,userB)>


9.3 Ledger shard DO id
MVP-1 uses one shard:
shard_id = "0"


ledger_key = tenant_id + "|ledger|" + shard_id


DO id: LedgerShardObject.idFromName(ledger_key)


This prevents collisions across tenants and makes horizontal scaling trivial later.

10) Storage sizes + limits (so DO storage doesn’t explode)
These numbers are intentionally conservative:
RoomObject
hot_limit = 500 messages


Each message body max 8 KB


Worst case hot payload ~ 4 MB-ish (plus overhead). That’s okay.


Idempotency map:
seen_limit = 2000 entries


Store {client_request_id -> {msg_id, room_seq, receipt_seq}}


Drop oldest on overflow.


LedgerShardObject
atoms_hot_limit = 2000 atoms


Since you write 2 atoms per message, that’s ~1000 messages of receipt history.


This is enough to prove the concept. Later you’ll snapshot to R2.

11) Security checks you must do in MVP-1 (not later)
Even though MVP-1 is “internal mode”, do these now so you don’t create a soft underbelly.
11.1 Access identity required
Every request must have identity; else 401.
REST: 401 JSON error envelope


MCP: JSON-RPC error -32001


11.2 Tenant membership
For MVP-1:
Auto-create tenant on first touch


Auto-add first user as owner


For any additional users:


either auto-add (if you want frictionless)


or reject (if you want strict) with forbidden


Pick one now.
I choose frictionless for MVP-1: auto-add anyone who shares the email domain. This matches deterministic tenancy and makes it usable immediately.
11.3 Room membership
If caller is not in room members, reject not_a_member.


For MVP-1 frictionless, you may also auto-join them to r:general if it’s the default room.


11.4 MCP Origin validation
Even if you’re behind Access, enforce it:
If Origin header exists and does not match your allowed origins list, 403.


Allowed origins list:


your own UI origin(s)


your portal origin(s) (later you can widen)


This is a simple “don’t get pwned by DNS rebinding” baseline.

12) “Single truth” correlation IDs (so logs and receipts line up)
You need one correlation id that appears everywhere:
12.1 request_id
REST: use X-Request-Id if present; else generate req:<uuid>


MCP: accept client_request_id in tool args; if missing generate req:<uuid>


12.2 trace in ledger atoms
Every action.v1 includes:
trace.request_id = request_id


This is how you correlate:
Access logs (per request)


portal logs (tool call)


ledger receipts (request_id)


room messages (receipt pointer)


This becomes your “audit superpower” later.

13) The exact JSON structures for room bootstrap
13.1 Auto-create 
r:general
On tenant creation, create:
r:general with name general


add the creator as owner


Emit a system message in r:general:
{
  "type":"system",
  "body":{"text":"Room created: general"}
}
This is helpful because it proves receipts and ordering even before a user types.
13.2 Auto-join behavior
When a new user joins tenant for first time:
add them to tenant members as member


add them to r:general members as member


emit system message: "u:<id> joined"


All system messages are receipted too. That’s key.

14) Exact SSE event list (MVP-1 final)
message.created
id: room_seq


payload: full message object


room.gap
id: hot_min_seq


payload:


{
  "from_seq": 1,
  "available_from": 120
}
room.member_joined (optional)
id: current room_seq (the system message seq)


payload:


{"user_id":"u:...","role":"member"}
Keep MVP-1 minimal: message.created + room.gap are enough.

15) MCP methods (final strict set for MVP-1)
Supported JSON-RPC methods:
initialize


tools/list


tools/call


Tools:
messenger.list_rooms


messenger.send


messenger.history


office.document.create


office.document.get


office.document.search


office.llm.complete


Any other method returns JSON-RPC -32601 method not found.
Initialize result includes:
session_id (string)


capabilities.tools=true


capabilities.streaming=true (even if you don’t stream tool output yet)

 That prevents a protocol redesign when you add MCP streaming.



16) Portal posture (how you actually use the new Cloudflare MCP products)
Even in MVP-1, you treat portal URL as canonical MCP surface.
Rule
Your server is at /mcp


Your public MCP endpoint for agents is portal URL only


Why
single stable entrypoint for future tool universe


tool call logs at portal level


easy curation later


In practice you will test MCP calls both ways:
direct to /mcp for debugging


via portal URL for “real behavior”



17) iPhone PWA minimal UI contract (no design fluff)
You need only 3 screens:
Rooms


GET /api/rooms


Room view


GET /api/rooms/:id/history


connect SSE /api/events/rooms/:id


Compose


POST /api/rooms/:id/messages


That’s it.
If you do nothing else, you’ve already made Cloudflare your computer.

18) The test plan (what you should literally do to validate MVP-1)
18.1 Basic correctness (single device)
Open PWA on iPhone


Login via Access


Rooms load (should include general)


Send “hello”


Confirm UI shows:


room_seq increments


receipt seq exists


Reload page


History loads and shows message


SSE reconnects and you can send again


18.2 Reconnect correctness (simulate a drop)
Turn on airplane mode for 10 seconds


Turn it off


SSE reconnects with from_seq


If gap occurs, UI triggers REST backfill


18.3 Receipt lookup
Tap a message “details”


Call GET /api/receipts/:seq


Confirm action+effect atoms exist and refer to msg_id and room_seq


18.4 MCP parity (agent test)
From an MCP client:
initialize


tools/list (sees messenger.* + office.* tools)


tools/call messenger.send to r:general


iPhone sees the message arrive live via SSE


tools/call office.document.create (creates document, emits receipt)


tools/call office.llm.complete (via AI Gateway, emits receipt)


That proves:
REST and MCP converge to the same RoomObject + LedgerShard


Office MCP Server + Client working


the system is truly programmable


Agreement-first: all actions reference Agreements


Container primitive: Rooms and Workspaces are Containers



19) The “future lock-in points” you’ve now secured
Because you implemented MVP-1 this way, you can add later without breaking:
MVP-2 approvals: proposals are just messages + additional states + Workflows


E2EE rooms: swap message payload to ciphertext and store key metadata


External MCP consumption: portal grows to include other servers; connectors can re-expose


Sandbox: tools call into Sandbox SDK and post receipts + artifacts back into rooms


AI hardening: model calls routed through AI Gateway + protected by Firewall for AI rules


Your core contracts (messages, receipts, streams, MCP tools) stay stable.

If you want me to keep going, the next most valuable "dense spec" to write is the **D1 schema + R2 object key layout + snapshot policy** (so you can rehydrate state cleanly without DO hot limits).

After that, MVP-2: PROPOSE/LOCK/EXECUTE/SETTLE in the RoomObject with Workflows as the executor and Messenger as the approval UI — which is exactly the UBL mini-contract soul.

---

## The Poetry Made Concrete

This blueprint now embodies:
- **Agreement-first**: Every action references an Agreement (RoomMembership, WorkspaceAgreement, ToolAccess, WorkflowApproval)
- **Container primitive**: Rooms, Workspaces, Wallets — all are Containers with different physics (governed by their Agreements)
- **Event sourcing**: State is derived from events, never stored directly (replay to reconstruct)
- **Universal transfer**: One operation (transfer) works for messages, documents, memberships (physics determine behavior)
- **Office as MCP**: Office is both server (exposes office.* tools) and client (consumes messenger.* and external tools), all receipted

The ledger doesn't just record events. It records relationships (Agreements) and their consequences (effects). This is the Universal Business Ledger — not just a database, but a formalization of business reality where every action traces to its authorization (the Agreement) and its consequence (the effect).

---

## Migration Path

**Can we transition from the current state to this architecture?**

**Yes!** See `PLANO_TRANSICAO.md` for a detailed migration plan.

**Quick Summary:**
- **Current State**: Fragmented workers (Office has 4 separate workers), multiple D1/R2 instances, no Agreement-first
- **Target State**: 5 core workers, single UBL Ledger, Agreement-first, Container primitive, MCP-First
- **Migration**: 8 phases over 14-20 weeks (or 4-6 weeks for MVP-1)

**Key Migration Steps:**
1. Consolidate UBL Ledger (add hash chain, Agreement tracking)
2. Consolidate Office (unify 4 workers into 1)
3. Consolidate Messenger (unify rtc + proxy)
4. Create Gateway Worker (central routing)
5. Implement Agreement-first (all actions reference Agreements)
6. Implement Container primitive (Rooms/Workspaces as Containers)
7. Complete MCP integration (MCP-First for all tools)
8. Implement Event Sourcing (state derived from events)

**MVP-1 Path (Faster):**
If you want to start with MVP-1 first (without all phases):
- Use existing `ubl-ledger` (add hash chain)
- Consolidate Office (unify workers)
- Consolidate Messenger (unify workers)
- Create Gateway (basic routing)
- Add MCP (basic tools)

**Timeline MVP-1: 4-6 weeks**

Then you can do phases 5-8 incrementally.

**See `PLANO_TRANSICAO.md` for complete details.**
