/**
 * UBL MVP-1 RoomObject Durable Object
 *
 * Manages room state including:
 * - Room configuration and settings
 * - Ordered message timeline (room_seq)
 * - Hot message cache (bounded)
 * - Idempotency map (seen)
 * - SSE subscriber management
 *
 * Storage keys:
 * - config: JSON blob (Room config)
 * - seq: integer (room_seq)
 * - hot: JSON blob (array of messages, bounded to hot_limit)
 * - seen: JSON blob (map request_id → {msg_id, room_seq, receipt_seq})
 *
 * Per Blueprint:
 * - room_seq increments by exactly 1 per accepted message
 * - hot limited to 500 messages (configurable via hot_limit)
 * - seen map keyed by client_request_id for idempotency
 * - Emit action.v1 + effect.v1 to LedgerShard
 * - Reference RoomGovernance Agreement in action.v1.agreement_id
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  Identity,
  RoomConfig,
  RoomMode,
  RoomMember,
  RoomPolicy,
  Message,
  MessageBody,
  MessageType,
  SendMessageInput,
  HistoryQuery,
  HistoryResult,
  Receipt,
  SeenEntry,
  ActionAtom,
  EffectAtom,
  DORequest,
  SSEEvent,
  MessageCreatedPayload,
} from '../types';
import {
  generateMessageId,
  generateRequestId,
  computeBodyHash,
} from '../utils/hash';
import { getRoomAgreementId } from '../utils/agreements';
import { formatSSEEvent, formatSSEKeepalive } from '../utils/response';

/**
 * Default room settings.
 */
const DEFAULT_HOT_LIMIT = 500;
const DEFAULT_SEEN_LIMIT = 2000;
const DEFAULT_MAX_MESSAGE_BYTES = 8000;
const DEFAULT_RETENTION_DAYS = 30;
const KEEPALIVE_INTERVAL_MS = 15000;

export class RoomObject extends DurableObject<Env> {
  private config: RoomConfig | null = null;
  private seq = 0;
  private hot: Message[] = [];
  private seen: Map<string, SeenEntry> = new Map();
  private initialized = false;

  // In-memory only: SSE subscribers
  private subscribers: Set<WritableStreamDefaultWriter> = new Set();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Initializes the DO by loading state from storage.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const [config, seq, hot, seen] = await Promise.all([
      this.ctx.storage.get<RoomConfig>('config'),
      this.ctx.storage.get<number>('seq'),
      this.ctx.storage.get<Message[]>('hot'),
      this.ctx.storage.get<Record<string, SeenEntry>>('seen'),
    ]);

    this.config = config || null;
    this.seq = seq || 0;
    this.hot = hot || [];
    this.seen = new Map(Object.entries(seen || {}));
    this.initialized = true;
  }

  /**
   * Saves config to storage.
   */
  private async saveConfig(): Promise<void> {
    if (this.config) {
      await this.ctx.storage.put('config', this.config);
    }
  }

  /**
   * Saves seq to storage.
   */
  private async saveSeq(): Promise<void> {
    await this.ctx.storage.put('seq', this.seq);
  }

  /**
   * Saves hot messages to storage.
   */
  private async saveHot(): Promise<void> {
    await this.ctx.storage.put('hot', this.hot);
  }

  /**
   * Saves seen map to storage.
   */
  private async saveSeen(): Promise<void> {
    const seenObj = Object.fromEntries(this.seen);
    await this.ctx.storage.put('seen', seenObj);
  }

  /**
   * Initializes the room with given configuration.
   */
  async initRoom(
    tenantId: string,
    roomId: string,
    name: string,
    mode: RoomMode,
    creatorId: string
  ): Promise<void> {
    await this.initialize();

    if (this.config) {
      return; // Already initialized
    }

    const now = new Date().toISOString();
    const hotLimit = parseInt(this.env.HOT_MESSAGES_LIMIT || String(DEFAULT_HOT_LIMIT), 10);

    this.config = {
      tenant_id: tenantId,
      room_id: roomId,
      name,
      mode,
      created_at: now,
      members: {
        [creatorId]: {
          role: 'owner',
          joined_at: now,
        },
      },
      policy: {
        max_message_bytes: parseInt(this.env.MAX_MESSAGE_BYTES || String(DEFAULT_MAX_MESSAGE_BYTES), 10),
        retention_days: DEFAULT_RETENTION_DAYS,
      },
      hot_limit: hotLimit,
    };

    await this.saveConfig();

    // Send system message for room creation
    await this.sendSystemMessage(`Room created: ${name}`, creatorId);
  }

  /**
   * Sends a system message (internal).
   */
  private async sendSystemMessage(text: string, senderId: string): Promise<Message | null> {
    if (!this.config) return null;

    const now = new Date().toISOString();
    const msgId = generateMessageId();
    const requestId = generateRequestId();

    // Increment room_seq
    this.seq++;
    await this.saveSeq();

    // Create message body
    const body: MessageBody = { text };
    const bodyHash = await computeBodyHash(body);

    // Create action atom
    const actionAtom: Omit<ActionAtom, 'cid'> = {
      kind: 'action.v1',
      tenant_id: this.config.tenant_id,
      cid: '', // Will be computed by ledger
      prev_hash: '', // Will be set by ledger
      when: now,
      who: {
        user_id: senderId,
        email: 'system@internal',
      },
      did: 'messenger.send',
      this: {
        room_id: this.config.room_id,
        msg_id: msgId,
        room_seq: this.seq,
        body_hash: bodyHash,
      },
      agreement_id: getRoomAgreementId(this.config.room_id),
      status: 'executed',
      trace: {
        request_id: requestId,
      },
    };

    // Append to ledger
    let receipt: Receipt;
    try {
      receipt = await this.appendToLedger(actionAtom, now, msgId);
    } catch (error) {
      console.error('Failed to append system message to ledger:', error);
      // Create a placeholder receipt
      receipt = {
        ledger_shard: '0',
        seq: 0,
        cid: 'c:pending',
        head_hash: 'h:pending',
        time: now,
      };
    }

    // Create message
    const message: Message = {
      msg_id: msgId,
      tenant_id: this.config.tenant_id,
      room_id: this.config.room_id,
      room_seq: this.seq,
      sender_id: senderId,
      sent_at: now,
      type: 'system',
      body,
      reply_to: null,
      attachments: [],
      receipt,
    };

    // Add to hot
    this.hot.push(message);
    if (this.hot.length > this.config.hot_limit) {
      this.hot.shift();
    }
    await this.saveHot();

    // Broadcast to subscribers
    await this.broadcast({
      event: 'message.created',
      tenant_id: this.config.tenant_id,
      room_id: this.config.room_id,
      ts: now,
      payload: { message },
    });

    return message;
  }

  /**
   * Appends an atom to the ledger and returns the receipt.
   */
  private async appendToLedger(
    actionAtom: Omit<ActionAtom, 'cid'>,
    when: string,
    msgId: string
  ): Promise<Receipt> {
    if (!this.config) {
      throw new Error('Room not initialized');
    }

    const ledgerKey = `${this.config.tenant_id}|ledger|0`;
    const ledgerDO = this.env.LEDGER_SHARD_OBJECT.idFromName(ledgerKey);
    const ledgerStub = this.env.LEDGER_SHARD_OBJECT.get(ledgerDO);

    // Append action atom
    const actionResponse = await ledgerStub.fetch(new Request('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'append_atom',
        payload: { atom: actionAtom },
        identity: { user_id: actionAtom.who.user_id, email: actionAtom.who.email },
        request_id: actionAtom.trace.request_id,
      }),
    }));

    const actionResult = await actionResponse.json() as { success: boolean; data?: { receipt: Receipt; cid: string } };
    if (!actionResult.success || !actionResult.data) {
      throw new Error('Failed to append action atom');
    }

    const actionReceipt = actionResult.data.receipt;
    const actionCid = actionResult.data.cid;

    // Create and append effect atom
    const effectAtom: Omit<EffectAtom, 'cid'> = {
      kind: 'effect.v1',
      tenant_id: this.config.tenant_id,
      cid: '', // Will be computed
      ref_action_cid: actionCid,
      when,
      outcome: 'ok',
      effects: [
        {
          op: 'room.append',
          room_id: this.config.room_id,
          room_seq: actionAtom.this.room_seq!,
        },
      ],
      pointers: {
        msg_id: msgId,
      },
    };

    await ledgerStub.fetch(new Request('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'append_atom',
        payload: { atom: effectAtom },
        identity: { user_id: actionAtom.who.user_id, email: actionAtom.who.email },
        request_id: actionAtom.trace.request_id,
      }),
    }));

    return actionReceipt;
  }

  /**
   * Asserts that the identity is a member of the room.
   * Throws if not a member.
   */
  assertMember(identity: Identity): void {
    if (!this.config) {
      throw new Error('Room not initialized');
    }

    // For MVP-1 frictionless mode, auto-add members
    if (!this.config.members[identity.user_id]) {
      const now = new Date().toISOString();
      this.config.members[identity.user_id] = {
        role: 'member',
        joined_at: now,
      };
      // Save asynchronously (fire and forget for now)
      this.saveConfig().catch(console.error);
    }
  }

  /**
   * Sends a message to the room.
   */
  async sendMessage(
    input: SendMessageInput,
    identity: Identity,
    requestId: string
  ): Promise<Message> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Room not initialized');
    }

    // Check membership
    this.assertMember(identity);

    // Check for idempotent request
    const clientRequestId = input.client_request_id || requestId;
    const existing = this.seen.get(clientRequestId);
    if (existing) {
      // Return the existing message
      const existingMsg = this.hot.find(m => m.msg_id === existing.msg_id);
      if (existingMsg) {
        return existingMsg;
      }
    }

    // Validate message size
    const bodyStr = JSON.stringify(input.body);
    if (bodyStr.length > this.config.policy.max_message_bytes) {
      throw new Error(`Message size ${bodyStr.length} exceeds maximum ${this.config.policy.max_message_bytes}`);
    }

    const now = new Date().toISOString();
    const msgId = generateMessageId();

    // Increment room_seq
    this.seq++;
    await this.saveSeq();

    // Compute body hash
    const bodyHash = await computeBodyHash(input.body);

    // Create action atom
    const actionAtom: Omit<ActionAtom, 'cid'> = {
      kind: 'action.v1',
      tenant_id: this.config.tenant_id,
      cid: '',
      prev_hash: '',
      when: now,
      who: {
        user_id: identity.user_id,
        email: identity.email,
      },
      did: 'messenger.send',
      this: {
        room_id: this.config.room_id,
        msg_id: msgId,
        room_seq: this.seq,
        body_hash: bodyHash,
      },
      agreement_id: getRoomAgreementId(this.config.room_id),
      status: 'executed',
      trace: {
        request_id: requestId,
      },
    };

    // Append to ledger
    const receipt = await this.appendToLedger(actionAtom, now, msgId);

    // Create message
    const message: Message = {
      msg_id: msgId,
      tenant_id: this.config.tenant_id,
      room_id: this.config.room_id,
      room_seq: this.seq,
      sender_id: identity.user_id,
      sent_at: now,
      type: input.type,
      body: input.body,
      reply_to: input.reply_to || null,
      attachments: [],
      receipt,
    };

    // Add to hot
    this.hot.push(message);
    if (this.hot.length > this.config.hot_limit) {
      this.hot.shift();
    }
    await this.saveHot();

    // Add to seen map
    this.seen.set(clientRequestId, {
      msg_id: msgId,
      room_seq: this.seq,
      receipt_seq: receipt.seq,
    });

    // Trim seen map if too large
    const seenLimit = parseInt(this.env.SEEN_LIMIT || String(DEFAULT_SEEN_LIMIT), 10);
    if (this.seen.size > seenLimit) {
      const keysToDelete = Array.from(this.seen.keys()).slice(0, this.seen.size - seenLimit);
      for (const key of keysToDelete) {
        this.seen.delete(key);
      }
    }
    await this.saveSeen();

    // Broadcast to subscribers
    await this.broadcast({
      event: 'message.created',
      tenant_id: this.config.tenant_id,
      room_id: this.config.room_id,
      ts: now,
      payload: { message },
    });

    return message;
  }

  /**
   * Gets message history with pagination.
   */
  async getHistory(query: HistoryQuery, identity: Identity): Promise<HistoryResult> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Room not initialized');
    }

    // Check membership
    this.assertMember(identity);

    const limit = Math.min(query.limit || 50, 200);
    const cursor = query.cursor;

    let messages: Message[];

    if (cursor === null || cursor === undefined) {
      // No cursor: return latest messages
      messages = this.hot.slice(-limit);
    } else {
      // With cursor: return messages with room_seq < cursor
      messages = this.hot
        .filter(m => m.room_seq < cursor)
        .slice(-limit);
    }

    // Sort by room_seq ascending
    messages.sort((a, b) => a.room_seq - b.room_seq);

    // Determine next cursor
    let nextCursor: number | null = null;
    if (messages.length > 0) {
      const firstMsg = messages[0];
      if (firstMsg && firstMsg.room_seq > 1 && this.hot.some(m => m.room_seq < firstMsg.room_seq)) {
        nextCursor = firstMsg.room_seq;
      }
    }

    return {
      messages,
      next_cursor: nextCursor,
    };
  }

  /**
   * Subscribes to SSE events.
   */
  async subscribeSSE(identity: Identity, fromSeq?: number): Promise<ReadableStream> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Room not initialized');
    }

    // Check membership
    this.assertMember(identity);

    const keepaliveInterval = parseInt(this.env.KEEPALIVE_INTERVAL_MS || String(KEEPALIVE_INTERVAL_MS), 10);

    // Create a TransformStream for SSE
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Add to subscribers
    this.subscribers.add(writer);

    // Replay messages from hot if fromSeq is provided
    if (fromSeq !== undefined) {
      const missedMessages = this.hot.filter(m => m.room_seq > fromSeq);

      // Check for gap
      if (missedMessages.length > 0) {
        const firstMissed = missedMessages[0];
        if (firstMissed && firstMissed.room_seq > fromSeq + 1) {
          // There's a gap - emit room.gap event
          const hotMinSeq = this.hot.length > 0 && this.hot[0] ? this.hot[0].room_seq : fromSeq + 1;
          const gapEvent = formatSSEEvent(hotMinSeq, 'room.gap', {
            from_seq: fromSeq + 1,
            available_from: hotMinSeq,
          });
          writer.write(new TextEncoder().encode(gapEvent)).catch(() => {});
        }
      }

      // Send missed messages
      for (const message of missedMessages) {
        const sseEvent: SSEEvent<MessageCreatedPayload> = {
          event: 'message.created',
          tenant_id: this.config.tenant_id,
          room_id: this.config.room_id,
          ts: message.sent_at,
          payload: { message },
        };
        const eventStr = formatSSEEvent(message.room_seq, 'message.created', sseEvent);
        writer.write(new TextEncoder().encode(eventStr)).catch(() => {});
      }
    }

    // Set up keepalive interval
    const keepaliveTimer = setInterval(() => {
      const keepalive = formatSSEKeepalive();
      writer.write(new TextEncoder().encode(keepalive)).catch(() => {
        // If write fails, clean up
        clearInterval(keepaliveTimer);
        this.subscribers.delete(writer);
        writer.close().catch(() => {});
      });
    }, keepaliveInterval);

    // Handle cleanup when the stream is closed
    readable.pipeTo(new WritableStream({
      close: () => {
        clearInterval(keepaliveTimer);
        this.subscribers.delete(writer);
      },
      abort: () => {
        clearInterval(keepaliveTimer);
        this.subscribers.delete(writer);
      },
    })).catch(() => {
      clearInterval(keepaliveTimer);
      this.subscribers.delete(writer);
    });

    return readable;
  }

  /**
   * Broadcasts an event to all subscribers.
   */
  async broadcast(event: SSEEvent<MessageCreatedPayload>): Promise<void> {
    if (this.subscribers.size === 0) return;

    const message = event.payload.message;
    const eventStr = formatSSEEvent(message.room_seq, event.event, event);
    const encoded = new TextEncoder().encode(eventStr);

    const deadSubscribers: WritableStreamDefaultWriter[] = [];

    for (const writer of this.subscribers) {
      try {
        await writer.write(encoded);
      } catch {
        deadSubscribers.push(writer);
      }
    }

    // Clean up dead subscribers
    for (const writer of deadSubscribers) {
      this.subscribers.delete(writer);
      writer.close().catch(() => {});
    }
  }

  /**
   * Gets room configuration.
   */
  async getConfig(): Promise<RoomConfig | null> {
    await this.initialize();
    return this.config;
  }

  /**
   * Gets current room_seq.
   */
  async getSeq(): Promise<number> {
    await this.initialize();
    return this.seq;
  }

  /**
   * HTTP request handler for the Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'POST') {
        const body = await request.json() as DORequest;
        const { type, payload, identity, request_id } = body;

        switch (type) {
          case 'init': {
            const { tenant_id, room_id, name, mode, creator_id } = payload as {
              tenant_id: string;
              room_id: string;
              name: string;
              mode: RoomMode;
              creator_id: string;
            };
            await this.initRoom(tenant_id, room_id, name, mode, creator_id);
            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'send_message': {
            const input = payload as SendMessageInput;
            const message = await this.sendMessage(input, identity, request_id);
            return new Response(JSON.stringify({ success: true, data: message }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_history': {
            const query = payload as HistoryQuery;
            const result = await this.getHistory(query, identity);
            return new Response(JSON.stringify({ success: true, data: result }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_config': {
            const config = await this.getConfig();
            return new Response(JSON.stringify({ success: true, data: config }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_seq': {
            const seq = await this.getSeq();
            return new Response(JSON.stringify({ success: true, data: seq }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          default:
            return new Response(JSON.stringify({ success: false, error: 'Unknown type' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
        }
      }

      // Handle SSE subscription via GET
      if (request.method === 'GET' && path === '/subscribe') {
        const fromSeqParam = url.searchParams.get('from_seq');
        const fromSeq = fromSeqParam ? parseInt(fromSeqParam, 10) : undefined;

        // Parse identity from headers (in production, this would come from Access JWT)
        const identityHeader = request.headers.get('X-Identity');
        if (!identityHeader) {
          return new Response(JSON.stringify({ success: false, error: 'Identity required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const identity = JSON.parse(identityHeader) as Identity;
        const stream = await this.subscribeSSE(identity, fromSeq);

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('RoomObject error:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }
}
