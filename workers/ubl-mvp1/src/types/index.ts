/**
 * UBL MVP-1 Type Definitions
 * Universal Business Ledger - Core Types
 */

// ============================================================================
// Environment and Bindings
// ============================================================================

export interface Env {
  // Durable Objects
  TENANT_OBJECT: DurableObjectNamespace;
  ROOM_OBJECT: DurableObjectNamespace;
  LEDGER_SHARD_OBJECT: DurableObjectNamespace;
  WORKSPACE_OBJECT: DurableObjectNamespace;

  // D1 Database
  D1_LEDGER: D1Database;

  // R2 Bucket
  R2_LEDGER: R2Bucket;

  // KV Namespace
  KV_POLICIES: KVNamespace;

  // Environment variables
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  MAX_MESSAGE_BYTES: string;
  HOT_MESSAGES_LIMIT: string;
  HOT_ATOMS_LIMIT: string;
  SEEN_LIMIT: string;
  KEEPALIVE_INTERVAL_MS: string;
}

// ============================================================================
// Identity Types
// ============================================================================

export interface Identity {
  user_id: string;        // "u:<stable-sub>"
  email: string;
  email_domain: string;
  groups: string[];
  is_service: boolean;
}

export interface IdentityContext {
  identity: Identity;
  tenant_id: string;
  role: TenantRole;
  request_id: string;
}

// ============================================================================
// Tenant Types
// ============================================================================

export type TenantRole = 'owner' | 'admin' | 'member';
export type TenantType = 'platform' | 'customer';

export interface TenantMember {
  role: TenantRole;
  email: string;
  joined_at: string;
}

export interface TenantDefaults {
  room_mode: RoomMode;
  retention_days: number;
  max_message_bytes: number;
}

export interface Tenant {
  tenant_id: string;
  type: TenantType;
  created_at: string;
  members: Record<string, TenantMember>;
  defaults: TenantDefaults;
}

// ============================================================================
// Room Types
// ============================================================================

export type RoomMode = 'internal' | 'external' | 'e2ee';
export type MessageType = 'text' | 'system';

export interface RoomMember {
  role: TenantRole;
  joined_at: string;
}

export interface RoomPolicy {
  max_message_bytes: number;
  retention_days: number;
}

export interface RoomConfig {
  tenant_id: string;
  room_id: string;
  name: string;
  mode: RoomMode;
  created_at: string;
  members: Record<string, RoomMember>;
  policy: RoomPolicy;
  hot_limit: number;
}

export interface RoomSummary {
  room_id: string;
  name: string;
  mode: RoomMode;
  created_at: string;
}

export interface MessageBody {
  text: string;
}

export interface Receipt {
  ledger_shard: string;
  seq: number;
  cid: string;
  head_hash: string;
  time: string;
}

export interface Message {
  msg_id: string;
  tenant_id: string;
  room_id: string;
  room_seq: number;
  sender_id: string;
  sent_at: string;
  type: MessageType;
  body: MessageBody;
  reply_to: string | null;
  attachments: unknown[];
  receipt: Receipt;
}

export interface SendMessageInput {
  type: MessageType;
  body: MessageBody;
  reply_to?: string | null;
  client_request_id?: string | null;
}

export interface HistoryQuery {
  cursor?: number | null;
  limit?: number | null;
}

export interface HistoryResult {
  messages: Message[];
  next_cursor: number | null;
}

export interface SeenEntry {
  msg_id: string;
  room_seq: number;
  receipt_seq: number;
}

// ============================================================================
// Ledger Types
// ============================================================================

export type AtomKind = 'action.v1' | 'effect.v1';
export type ActionDid =
  | 'messenger.send'
  | 'room.create'
  | 'tenant.create'
  | 'office.document.create'
  | 'office.document.get'
  | 'office.document.search'
  | 'office.llm.complete'
  | 'policy.evaluate';

export type ActionStatus = 'executed' | 'pending' | 'failed';
export type EffectOutcome = 'ok' | 'error';
export type EffectOp = 'room.append' | 'workspace.append' | 'document.create';

export interface ActionWho {
  user_id: string;
  email: string;
  is_service?: boolean;
}

export interface ActionTrace {
  request_id: string;
}

export interface ActionThis {
  room_id?: string;
  msg_id?: string;
  room_seq?: number;
  body_hash?: string;
  workspace_id?: string;
  document_id?: string;
  content_hash?: string;
}

export interface ActionAtom {
  kind: 'action.v1';
  tenant_id: string;
  cid: string;
  prev_hash: string;
  when: string;
  who: ActionWho;
  did: ActionDid;
  this: ActionThis;
  agreement_id?: string | null;
  status: ActionStatus;
  trace: ActionTrace;
}

export interface EffectItem {
  op: EffectOp;
  room_id?: string;
  room_seq?: number;
  workspace_id?: string;
  document_id?: string;
}

export interface EffectPointers {
  msg_id?: string;
  document_id?: string;
}

export interface EffectError {
  code: string;
  message: string;
}

export interface EffectAtom {
  kind: 'effect.v1';
  tenant_id: string;
  cid: string;
  ref_action_cid: string;
  when: string;
  outcome: EffectOutcome;
  effects: EffectItem[];
  pointers: EffectPointers;
  error?: EffectError | null;
}

export type Atom = ActionAtom | EffectAtom;

export interface LedgerReceipt {
  ledger_shard: string;
  seq: number;
  cid: string;
  head_hash: string;
  time: string;
}

// ============================================================================
// Agreement Types
// ============================================================================

export type AgreementType =
  | 'tenant_license'
  | 'room_governance'
  | 'workspace_agreement'
  | 'tool_access'
  | 'workflow_approval';

export interface Agreement {
  id: string;
  type: AgreementType;
  tenant_id: string;
  created_at: string;
  created_by: string;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Workspace/Office Types
// ============================================================================

export interface Document {
  document_id: string;
  workspace_id: string;
  tenant_id: string;
  title: string;
  content: string;
  content_hash: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  version: number;
  receipt: Receipt;
}

export interface WorkspaceConfig {
  workspace_id: string;
  tenant_id: string;
  name: string;
  created_at: string;
  created_by: string;
  members: Record<string, RoomMember>;
  documents: string[];
}

export interface CreateDocumentInput {
  workspace_id: string;
  title: string;
  content: string;
}

export interface SearchDocumentsInput {
  workspace_id: string;
  query: string;
  limit?: number;
}

export interface LLMCompleteInput {
  workspace_id: string;
  prompt: string;
  model?: string;
  max_tokens?: number;
}

// ============================================================================
// SSE Event Types
// ============================================================================

export type SSEEventType =
  | 'message.created'
  | 'room.created'
  | 'room.member_joined'
  | 'room.gap';

export interface SSEEventBase {
  event: SSEEventType;
  tenant_id: string;
  room_id: string;
  ts: string;
}

export interface MessageCreatedPayload {
  message: Message;
}

export interface RoomCreatedPayload {
  room_id: string;
  name: string;
  mode: RoomMode;
  created_at: string;
}

export interface RoomMemberJoinedPayload {
  user_id: string;
  role: TenantRole | null;
}

export interface RoomGapPayload {
  from_seq: number;
  available_from: number;
}

export interface SSEEvent<T = unknown> extends SSEEventBase {
  payload: T;
}

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPServerInfo {
  name: string;
  version: string;
}

export interface MCPCapabilities {
  tools: boolean;
  streaming: boolean;
}

export interface MCPInitializeResult {
  serverInfo: MCPServerInfo;
  capabilities: MCPCapabilities;
  session_id: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolsListResult {
  tools: MCPTool[];
}

export interface MCPToolCallParams {
  session_id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPContent {
  type: 'json' | 'text';
  json?: unknown;
  text?: string;
}

export interface MCPToolCallResult {
  content: MCPContent[];
}

// ============================================================================
// API Response Types
// ============================================================================

export interface APIResponse<T = unknown> {
  data?: T;
  error?: APIError;
  request_id: string;
  server_time: string;
}

export interface APIError {
  code: string;
  message: string;
  details?: unknown;
}

export interface WhoamiResponse {
  identity: Identity;
  tenant_id: string;
  role: TenantRole;
  request_id: string;
  server_time: string;
}

export interface ListRoomsResponse {
  rooms: RoomSummary[];
  request_id: string;
  server_time: string;
}

export interface CreateRoomResponse {
  room_id: string;
  request_id: string;
  server_time: string;
}

export interface SendMessageResponse {
  message: Message;
  request_id: string;
  server_time: string;
}

export interface GetHistoryResponse {
  messages: Message[];
  next_cursor: number | null;
  request_id: string;
  server_time: string;
}

export interface GetReceiptResponse {
  seq: number;
  atoms: Atom[];
  request_id: string;
  server_time: string;
}

// ============================================================================
// Internal Communication Types
// ============================================================================

export interface DORequest {
  type: string;
  payload: unknown;
  identity: Identity;
  request_id: string;
}

export interface DOResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
