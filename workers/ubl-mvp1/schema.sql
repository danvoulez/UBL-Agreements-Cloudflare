-- UBL MVP-1 D1 Database Schema
-- This schema supports the UBL ledger, agreements, and auxiliary data.

-- ============================================================================
-- Tenants Table
-- Stores tenant metadata for fast lookup and cross-DO queries.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,                    -- Tenant ID (e.g., "t:example.com")
    type TEXT NOT NULL DEFAULT 'customer',  -- "platform" or "customer"
    name TEXT,                              -- Display name
    created_at TEXT NOT NULL,               -- ISO 8601 timestamp
    metadata TEXT DEFAULT '{}',             -- JSON metadata
    CONSTRAINT tenants_type_check CHECK (type IN ('platform', 'customer'))
);

-- Index for listing tenants
CREATE INDEX IF NOT EXISTS idx_tenants_created_at ON tenants(created_at);

-- ============================================================================
-- Agreements Table
-- Stores all agreements (TenantLicense, RoomGovernance, WorkspaceAgreement, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agreements (
    id TEXT PRIMARY KEY,                    -- Agreement ID (e.g., "a:tenant:t:example.com")
    type TEXT NOT NULL,                     -- Agreement type
    tenant_id TEXT NOT NULL,                -- Tenant this agreement belongs to
    created_at TEXT NOT NULL,               -- ISO 8601 timestamp
    created_by TEXT NOT NULL,               -- User ID who created the agreement
    metadata TEXT DEFAULT '{}',             -- JSON metadata (capabilities, terms, etc.)
    CONSTRAINT agreements_type_check CHECK (type IN (
        'tenant_license',
        'room_governance',
        'workspace_agreement',
        'tool_access',
        'workflow_approval'
    ))
);

-- Indexes for agreement lookups
CREATE INDEX IF NOT EXISTS idx_agreements_tenant_id ON agreements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agreements_type ON agreements(type);
CREATE INDEX IF NOT EXISTS idx_agreements_created_at ON agreements(created_at);

-- ============================================================================
-- Spans Table (Ledger Atoms)
-- Stores ledger atoms (action.v1, effect.v1) for persistent storage and querying.
-- The actual hash chain is maintained in the LedgerShardObject DO.
-- ============================================================================
CREATE TABLE IF NOT EXISTS spans (
    id TEXT PRIMARY KEY,                    -- Span ID (e.g., "span:1042")
    tenant_id TEXT NOT NULL,                -- Tenant ID
    user_id TEXT,                           -- User ID (null for system actions)
    app_id TEXT NOT NULL DEFAULT 'ubl-mvp1', -- Application ID
    ts TEXT NOT NULL,                       -- Timestamp (from atom.when)
    kind TEXT NOT NULL,                     -- Atom kind ("action.v1" or "effect.v1")
    hash TEXT NOT NULL,                     -- CID (content hash)
    size INTEGER NOT NULL DEFAULT 0,        -- Size in bytes
    r2_key TEXT,                            -- R2 key for archived atoms (null if in hot cache)
    metadata TEXT DEFAULT '{}',             -- JSON metadata (full atom, seq, head_hash)
    CONSTRAINT spans_kind_check CHECK (kind IN ('action.v1', 'effect.v1'))
);

-- Indexes for span queries
CREATE INDEX IF NOT EXISTS idx_spans_tenant_id ON spans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spans_user_id ON spans(user_id);
CREATE INDEX IF NOT EXISTS idx_spans_ts ON spans(ts);
CREATE INDEX IF NOT EXISTS idx_spans_kind ON spans(kind);
CREATE INDEX IF NOT EXISTS idx_spans_hash ON spans(hash);

-- ============================================================================
-- Rooms Table (Room Index)
-- Stores room metadata for fast lookup across tenants.
-- The actual room state is maintained in the RoomObject DO.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,                    -- Room ID (e.g., "r:general")
    tenant_id TEXT NOT NULL,                -- Tenant ID
    name TEXT NOT NULL,                     -- Room name
    mode TEXT NOT NULL DEFAULT 'internal',  -- Room mode
    created_at TEXT NOT NULL,               -- ISO 8601 timestamp
    created_by TEXT NOT NULL,               -- User ID who created the room
    agreement_id TEXT,                      -- Reference to RoomGovernance Agreement
    metadata TEXT DEFAULT '{}',             -- JSON metadata
    CONSTRAINT rooms_mode_check CHECK (mode IN ('internal', 'external', 'e2ee'))
);

-- Indexes for room queries
CREATE INDEX IF NOT EXISTS idx_rooms_tenant_id ON rooms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at);

-- ============================================================================
-- Documents Table (Document Index)
-- Stores document metadata for search and indexing.
-- The actual document content is stored in the WorkspaceObject DO or R2.
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,                    -- Document ID (e.g., "d:uuid")
    workspace_id TEXT NOT NULL,             -- Workspace ID
    tenant_id TEXT NOT NULL,                -- Tenant ID
    title TEXT NOT NULL,                    -- Document title
    content_hash TEXT NOT NULL,             -- Content hash for deduplication
    created_at TEXT NOT NULL,               -- ISO 8601 timestamp
    created_by TEXT NOT NULL,               -- User ID who created the document
    updated_at TEXT NOT NULL,               -- Last update timestamp
    version INTEGER NOT NULL DEFAULT 1,     -- Version number
    r2_key TEXT,                            -- R2 key for document content
    metadata TEXT DEFAULT '{}',             -- JSON metadata
    -- Full-text search column (SQLite FTS5 would be better, but D1 has limitations)
    search_text TEXT                        -- Concatenated searchable text
);

-- Indexes for document queries
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);

-- ============================================================================
-- Messages Table (Message Index)
-- Stores message metadata for search and cross-room queries.
-- The actual message timeline is maintained in the RoomObject DO.
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,                    -- Message ID (e.g., "m:uuid")
    room_id TEXT NOT NULL,                  -- Room ID
    tenant_id TEXT NOT NULL,                -- Tenant ID
    room_seq INTEGER NOT NULL,              -- Room sequence number
    sender_id TEXT NOT NULL,                -- Sender user ID
    sent_at TEXT NOT NULL,                  -- ISO 8601 timestamp
    type TEXT NOT NULL DEFAULT 'text',      -- Message type
    receipt_seq INTEGER,                    -- Ledger sequence number
    receipt_cid TEXT,                       -- Ledger CID
    body_hash TEXT,                         -- Body hash
    metadata TEXT DEFAULT '{}',             -- JSON metadata
    CONSTRAINT messages_type_check CHECK (type IN ('text', 'system'))
);

-- Indexes for message queries
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_id ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, room_seq);

-- ============================================================================
-- Sessions Table (MCP Sessions)
-- Stores MCP session metadata for session management.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,                    -- Session ID (e.g., "s:uuid")
    tenant_id TEXT NOT NULL,                -- Tenant ID
    user_id TEXT NOT NULL,                  -- User ID
    created_at TEXT NOT NULL,               -- ISO 8601 timestamp
    last_activity TEXT NOT NULL,            -- Last activity timestamp
    expires_at TEXT NOT NULL,               -- Expiration timestamp
    metadata TEXT DEFAULT '{}'              -- JSON metadata (client info, etc.)
);

-- Indexes for session queries
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================================
-- Audit Log Table
-- Stores audit events for compliance and debugging.
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,                   -- Action type (e.g., "tenant.create", "room.join")
    resource_type TEXT,                     -- Resource type (e.g., "tenant", "room", "message")
    resource_id TEXT,                       -- Resource ID
    request_id TEXT,                        -- Request ID for correlation
    ts TEXT NOT NULL,                       -- ISO 8601 timestamp
    metadata TEXT DEFAULT '{}'              -- JSON metadata (IP, user agent, etc.)
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_request_id ON audit_log(request_id);

-- ============================================================================
-- Policy Cache Table
-- Caches evaluated policies for performance.
-- ============================================================================
CREATE TABLE IF NOT EXISTS policy_cache (
    id TEXT PRIMARY KEY,                    -- Cache key (hash of policy + context)
    tenant_id TEXT NOT NULL,
    policy_id TEXT NOT NULL,                -- Policy identifier
    decision TEXT NOT NULL,                 -- "allow" or "deny"
    reason TEXT,                            -- Reason for decision
    evaluated_at TEXT NOT NULL,             -- ISO 8601 timestamp
    expires_at TEXT NOT NULL,               -- Cache expiration
    metadata TEXT DEFAULT '{}'              -- JSON metadata
);

-- Index for policy cache expiration
CREATE INDEX IF NOT EXISTS idx_policy_cache_expires_at ON policy_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_policy_cache_tenant_id ON policy_cache(tenant_id);
