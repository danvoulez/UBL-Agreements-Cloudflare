# TASKLIST — MVP-1 Build from Zero

## 🎯 Estratégia

**Manter:**
- ✅ Domínios DNS (ubl.agency, voulezvous.tv, etc.)
- ✅ Cloudflare Access (configurações existentes)
- ✅ Dados críticos (se houver, fazer backup primeiro)

**Apagar/Desativar:**
- ❌ Todos os workers atuais (fragmentados)
- ❌ D1/R2/KV antigos (exceto se tiver dados críticos)
- ❌ Código fragmentado

**Construir do Zero:**
- ✅ Seguindo Final Blueprint exatamente
- ✅ **MVP-1: Um único Worker** (depois split em 5 quando necessário)
- ✅ Agreement-first desde o início
- ✅ Container primitive desde o início
- ✅ MCP-First desde o início

**Decisão Arquitetural MVP-1:**
- **Um único Worker** para MVP-1 (evita complexidade de roteamento/proxy cedo)
- Split em 5 workers depois quando precisar de deploy independente ou failure domains separados

---

## 📋 FASE 0: Preparação e Limpeza (1 semana)

### 0.1 Backup de Dados Críticos (se houver)

- [ ] **Listar todos os D1 databases**
  - [ ] `wrangler d1 list` → anotar nomes e IDs
  - [ ] Identificar quais têm dados críticos
  - [ ] Para cada D1 crítico:
    - [ ] `wrangler d1 export <database_name> --output backup-<name>.sql`
    - [ ] Verificar arquivo SQL gerado

- [ ] **Listar todos os R2 buckets**
  - [ ] `wrangler r2 bucket list` → anotar nomes
  - [ ] Identificar quais têm dados críticos
  - [ ] Para cada R2 crítico:
    - [ ] `wrangler r2 object list <bucket_name>` → listar objetos
    - [ ] Fazer backup manual se necessário

- [ ] **Documentar configurações**
  - [ ] Documentar configurações de Access (apps, policies)
  - [ ] Documentar rotas DNS (domínios, CNAMEs)
  - [ ] Documentar secrets importantes (anotar nomes, não valores)

### 0.2 Desativar Workers Antigos

- [ ] **Listar todos os workers**
  - [ ] `wrangler deployments list` → listar todos os workers
  - [ ] Anotar nomes de todos os workers atuais

- [ ] **Desativar workers fragmentados**
  - [ ] Para cada worker antigo:
    - [ ] `wrangler deployments list --name <worker_name>` → ver deployments
    - [ ] `wrangler deployments rollback --name <worker_name>` → se necessário
    - [ ] Ou deletar: `wrangler delete <worker_name>` (se não for mais necessário)

- [ ] **Remover rotas antigas**
  - [ ] Verificar `wrangler.toml` de cada worker para rotas
  - [ ] Remover rotas DNS se necessário (via Cloudflare Dashboard ou API)

### 0.3 Limpar Recursos Cloudflare

- [ ] **Limpar D1 databases não críticos**
  - [ ] Para cada D1 não crítico:
    - [ ] `wrangler d1 delete <database_name>` (CUIDADO: irreversível)
    - [ ] Ou manter se quiser preservar por enquanto

- [ ] **Limpar R2 buckets não críticos**
  - [ ] Para cada R2 não crítico:
    - [ ] `wrangler r2 bucket delete <bucket_name>` (CUIDADO: irreversível)
    - [ ] Ou manter se quiser preservar por enquanto

- [ ] **Limpar KV namespaces não usados**
  - [ ] `wrangler kv:namespace list` → listar namespaces
  - [ ] Identificar quais não são mais usados
  - [ ] Deletar se necessário

### 0.4 Preparar Estrutura Nova

- [ ] **Criar diretório do Worker MVP-1**
  - [ ] `mkdir -p workers/ubl-mvp1/src`
  - [ ] `cd workers/ubl-mvp1`

- [ ] **Inicializar projeto Worker**
  - [ ] `npm init -y`
  - [ ] `npm install -D wrangler typescript @cloudflare/workers-types`
  - [ ] Criar `tsconfig.json` básico
  - [ ] Criar `wrangler.toml` básico (sem rotas ainda)

- [ ] **Criar estrutura de diretórios**
  - [ ] `mkdir -p src/durable-objects`
  - [ ] `mkdir -p src/routes`
  - [ ] `mkdir -p src/handlers`
  - [ ] `mkdir -p src/utils`

- [ ] **Verificar/criar crates/policy-engine**
  - [ ] Se `crates/policy-engine` existe: verificar estrutura
  - [ ] Se não existe: criar estrutura básica (será implementado depois)

- [ ] **Verificar/criar policies/**
  - [ ] Se `policies/` existe: verificar YAMLs
  - [ ] Se não existe: `mkdir -p policies`

**Deliverable:** Ambiente limpo, estrutura nova criada, pronto para construir

---

## 📋 FASE 1: MVP-1 Core Worker (2-3 semanas)

### 1.1 Provisionar Recursos Cloudflare

- [ ] **Criar D1 database**
  - [ ] `wrangler d1 create ubl_ledger`
  - [ ] Anotar `database_id` retornado
  - [ ] Adicionar `database_id` ao `wrangler.toml`:
    ```toml
    [[d1_databases]]
    binding = "D1_LEDGER"
    database_name = "ubl_ledger"
    database_id = "<database_id>"
    ```

- [ ] **Criar R2 bucket**
  - [ ] `wrangler r2 bucket create ubl-ledger`
  - [ ] Adicionar ao `wrangler.toml`:
    ```toml
    [[r2_buckets]]
    binding = "R2_LEDGER"
    bucket_name = "ubl-ledger"
    ```

- [ ] **Aplicar schema D1**
  - [ ] Criar `schema.sql` com:
    - [ ] Table `tenants` (id, name, created_at)
    - [ ] Table `spans` (id, tenant_id, user_id, app_id, ts, kind, hash, size, r2_key)
    - [ ] Table `agreements` (id, type, tenant_id, created_at, metadata)
    - [ ] Indexes apropriados
  - [ ] `wrangler d1 execute ubl_ledger --file=./schema.sql`

### 1.2 Implementar Canonicalization e Hash Chain

- [ ] **Criar `src/utils/canon.ts`**
  - [ ] Implementar `canonicalizeJSON(obj)`:
    - [ ] Ordenar chaves lexicograficamente
    - [ ] Remover espaços desnecessários
    - [ ] Normalizar números (sem -0, sem NaN/Infinity)
    - [ ] Normalizar Unicode (NFC)
    - [ ] Normalizar line endings (\r\n → \n)

- [ ] **Criar `src/utils/hash.ts`**
  - [ ] Implementar `sha256(data)` usando Web Crypto API
  - [ ] Implementar `computeCID(atom)` = SHA256(canonical(atom_without_cid))
  - [ ] Implementar `computeHeadHash(prev_hash, cid)` = SHA256(prev_hash + ":" + cid)
  - [ ] Implementar `genesisHash()` = "h:genesis"

### 1.3 Implementar Durable Objects

- [ ] **Criar `src/durable-objects/TenantObject.ts`**
  - [ ] Classe `TenantObject` extends `DurableObject`
  - [ ] Storage keys: `tenant`, `rooms`
  - [ ] Métodos:
    - [ ] `ensureTenantAndMember(identity)` → {tenant, role}
    - [ ] `listRooms()` → room_summaries[]
    - [ ] `createRoom({name}, identity)` → room_summary
  - [ ] Auto-create tenant no primeiro request
  - [ ] Auto-create `r:general` quando tenant é criado

- [ ] **Criar `src/durable-objects/RoomObject.ts`**
  - [ ] Classe `RoomObject` extends `DurableObject`
  - [ ] Storage keys: `config`, `seq`, `hot`, `seen`
  - [ ] In-memory: `subscribers` (Set de SSE streams)
  - [ ] Métodos:
    - [ ] `assertMember(identity)` → throws se não membro
    - [ ] `sendMessage({type, body, reply_to, request_id}, identity)` → message
    - [ ] `getHistory({cursor, limit}, identity)` → {messages, next_cursor}
    - [ ] `subscribeSSE(identity)` → stream_handle
    - [ ] `broadcast(event)` → void
  - [ ] `room_seq` incrementa monotonicamente
  - [ ] `hot` limitado a 500 mensagens
  - [ ] `seen` map para idempotência (2000 entries max)

- [ ] **Criar `src/durable-objects/LedgerShardObject.ts`**
  - [ ] Classe `LedgerShardObject` extends `DurableObject`
  - [ ] Storage keys: `seq`, `head`, `hot`, `dedupe`
  - [ ] Métodos:
    - [ ] `appendAtom(atom_no_cid)` → receipt {seq, cid, head_hash}
    - [ ] `getBySeq(seq)` → atoms[]
    - [ ] `queryRecent({cursor, limit})` → {atoms, next_cursor}
  - [ ] Hash chain: `head_hash = SHA256(prev_head_hash + ":" + cid)`
  - [ ] `hot` limitado a 2000 atoms
  - [ ] `dedupe` map (cid → seq)

### 1.4 Implementar Agreement Tracking

- [ ] **Criar `src/utils/agreements.ts`**
  - [ ] `createTenantLicenseAgreement(tenant_id, creator_id)` → Agreement
  - [ ] `createRoomGovernanceAgreement(room_id, tenant_id, creator_id)` → Agreement
  - [ ] `storeAgreement(agreement)` → void (salva no D1)
  - [ ] `getAgreement(agreement_id)` → Agreement | null

- [ ] **Integrar Agreements no TenantObject**
  - [ ] Quando tenant é criado: criar TenantLicense Agreement
  - [ ] Agreement ID: `a:tenant:<tenant_id>`

- [ ] **Integrar Agreements no RoomObject**
  - [ ] Quando room é criado: criar RoomGovernance Agreement
  - [ ] Agreement ID: `a:room:<room_id>`
  - [ ] Quando enviar mensagem: incluir `agreement_id = a:room:<room_id>` em `action.v1`

### 1.5 Implementar REST Endpoints

- [ ] **Criar `src/routes/api.ts`**
  - [ ] `GET /api/whoami` → {identity, tenant_id, role, request_id, server_time}
  - [ ] `GET /api/rooms` → {rooms[], request_id, server_time}
  - [ ] `POST /api/rooms` → {room_id, request_id, server_time}
  - [ ] `GET /api/rooms/:id/history` → {messages[], next_cursor, request_id, server_time}
  - [ ] `POST /api/rooms/:id/messages` → {message, request_id, server_time}
  - [ ] `GET /api/receipts/:seq` → {seq, atoms[], request_id, server_time}

- [ ] **Criar `src/handlers/rooms.ts`**
  - [ ] `handleListRooms(env, identity)` → Response
  - [ ] `handleCreateRoom(env, identity, body)` → Response
  - [ ] `handleGetHistory(env, identity, roomId, query)` → Response
  - [ ] `handleSendMessage(env, identity, roomId, body)` → Response

- [ ] **Criar `src/handlers/receipts.ts`**
  - [ ] `handleGetReceipt(env, identity, seq)` → Response

### 1.6 Implementar SSE Stream

- [ ] **Criar `src/routes/events.ts`**
  - [ ] `GET /api/events/rooms/:id` → SSE stream

- [ ] **Criar `src/handlers/events.ts`**
  - [ ] `handleSSEStream(env, identity, roomId, query)` → Response
  - [ ] SSE framing:
    - [ ] `id: <room_seq>` para cada evento
    - [ ] `event: message.created`
    - [ ] `data: <JSON>`
  - [ ] Keepalive a cada 15s: `:keepalive`
  - [ ] Suporte a `?from_seq=<last_id>` para reconnect

### 1.7 Implementar MCP Server

- [ ] **Criar `src/routes/mcp.ts`**
  - [ ] `POST /mcp` → JSON-RPC handler
  - [ ] `GET /mcp?session_id=...` → Streamable HTTP (keepalive-only MVP-1)

- [ ] **Criar `src/handlers/mcp.ts`**
  - [ ] `handleMCPRequest(env, identity, body)` → Response
  - [ ] Suportar métodos:
    - [ ] `initialize` → {serverInfo, capabilities, session_id}
    - [ ] `tools/list` → {tools[]}
    - [ ] `tools/call` → {content[]}
  - [ ] Origin validation (REQUIRED, 403 on mismatch)

- [ ] **Implementar MCP Tools**
  - [ ] `messenger.list_rooms` → {rooms[], next_cursor}
  - [ ] `messenger.send` → {message} (mesmo formato que REST)
  - [ ] `messenger.history` → {messages[], next_cursor}

- [ ] **JSON-RPC 2.0 compliance**
  - [ ] Request: {jsonrpc: "2.0", id, method, params}
  - [ ] Response: {jsonrpc: "2.0", id, result} ou {jsonrpc: "2.0", id, error}
  - [ ] Error codes: -32601 (method not found), -32001 (unauthorized), etc.

### 1.8 Configurar Cloudflare Access

- [ ] **Criar Access Application**
  - [ ] Cloudflare Dashboard → Zero Trust → Access → Applications
  - [ ] Add Application
  - [ ] Application name: "UBL MVP-1"
  - [ ] Application domain: `ubl.<your-domain>` ou `api.ubl.<your-domain>`
  - [ ] Session duration: 24h (ou conforme necessário)

- [ ] **Configurar Access Policies**
  - [ ] Policy 1: Allow (email domain match ou grupo específico)
  - [ ] Policy 2: Block (todos os outros)
  - [ ] Aplicar a `/ui/*`, `/api/*`, `/mcp`

- [ ] **Testar Access**
  - [ ] Acessar `/api/whoami` sem token → 401
  - [ ] Acessar `/api/whoami` com token válido → 200

### 1.9 Configurar MCP Server Portal

- [ ] **Adicionar Worker como MCP Server no Cloudflare One**
  - [ ] Cloudflare Dashboard → Zero Trust → Access → AI controls → MCP servers
  - [ ] Add MCP server
  - [ ] HTTP URL: `https://<your-domain>/mcp` (URL direta do Worker)
  - [ ] Attach Allow policy (mesma identidade que Access)
  - [ ] Confirmar status → Ready

- [ ] **Criar MCP Portal**
  - [ ] Cloudflare Dashboard → Zero Trust → Access → AI controls → Add MCP server portal
  - [ ] Choose custom domain/subdomain (ex: `mcp.<your-domain>`)
  - [ ] Add your MCP server into portal
  - [ ] Add Allow policy for who can connect
  - [ ] Portal URL será: `https://<subdomain>.<domain>/mcp`

- [ ] **Testar Portal**
  - [ ] Conectar via `mcp-remote@latest` usando portal URL
  - [ ] `initialize` → deve retornar serverInfo
  - [ ] `tools/list` → deve listar messenger.* tools
  - [ ] `tools/call messenger.send` → deve funcionar

### 1.10 Testes Básicos

- [ ] **Teste: Criar tenant**
  - [ ] `GET /api/whoami` → deve criar tenant automaticamente
  - [ ] Verificar D1: `tenants` table tem novo registro
  - [ ] Verificar D1: `agreements` table tem TenantLicense Agreement

- [ ] **Teste: Criar room**
  - [ ] `POST /api/rooms` → deve criar `r:general` automaticamente
  - [ ] Verificar D1: `agreements` table tem RoomGovernance Agreement

- [ ] **Teste: Enviar mensagem**
  - [ ] `POST /api/rooms/r:general/messages` → deve retornar message com receipt
  - [ ] Verificar `message.receipt.seq`, `message.receipt.cid`, `message.receipt.head_hash`
  - [ ] Verificar `message.action.v1.agreement_id` = `a:room:r:general`

- [ ] **Teste: Receipt lookup**
  - [ ] `GET /api/receipts/<seq>` → deve retornar `action.v1` + `effect.v1`
  - [ ] Verificar hash chain: `head_hash` calculado corretamente

- [ ] **Teste: MCP via Portal**
  - [ ] Conectar via portal URL
  - [ ] `tools/call messenger.send` → deve funcionar
  - [ ] Verificar Portal logs: Capability = `messenger.send`

**Deliverable:** MVP-1 Worker único funcionando, MCP Portal ativo, hash chain, Agreements

---

## 📋 FASE 2: Policy Engine Integration (1 semana)

### 2.1 Verificar/Criar Policy Engine

- [ ] **Se `crates/policy-engine` existe:**
  - [ ] Verificar estrutura
  - [ ] Verificar se compila para WASM
  - [ ] Testar localmente

- [ ] **Se não existe, criar básico:**
  - [ ] `mkdir -p crates/policy-engine/src`
  - [ ] Criar `Cargo.toml` com `wasm32-unknown-unknown` target
  - [ ] Implementar parser YAML básico
  - [ ] Implementar evaluator básico
  - [ ] Compilar: `cargo build --target wasm32-unknown-unknown --release`

### 2.2 Integrar WASM no Worker

- [ ] **Carregar WASM no Worker**
  - [ ] Copiar `.wasm` para `workers/ubl-mvp1/`
  - [ ] Adicionar ao `wrangler.toml`:
    ```toml
    [wasm_modules]
    policy_engine = "./policy-engine.wasm"
    ```

- [ ] **Criar `src/utils/policy.ts`**
  - [ ] `loadPolicyEngine()` → instância do WASM
  - [ ] `evaluatePolicy(policy, context)` → Decision {allow, deny, reason}

### 2.3 Integrar Policy Evaluation

- [ ] **Adicionar policy check antes de rotear**
  - [ ] Em cada handler, antes de processar:
    - [ ] Carregar política do KV (cache)
    - [ ] Avaliar contexto (identity, tenant, action)
    - [ ] Se deny → 403
    - [ ] Se allow → continuar

- [ ] **Emitir eventos de decisão para UBL Ledger**
  - [ ] Quando policy é avaliada: emitir `action.v1` com `did = "policy.evaluate"`
  - [ ] Incluir `decision` (allow/deny) no `action.v1.this`

### 2.4 Cache de Políticas

- [ ] **Armazenar políticas no KV**
  - [ ] Criar KV namespace: `wrangler kv:namespace create "POLICIES"`
  - [ ] Adicionar ao `wrangler.toml`
  - [ ] Carregar políticas do KV no startup
  - [ ] Cache TTL: 1h (ou conforme necessário)

### 2.5 Testes

- [ ] **Teste: Política permite**
  - [ ] Request com identity válida → deve passar
  - [ ] Verificar ledger: `action.v1` com `did = "policy.evaluate"`, `decision = "allow"`

- [ ] **Teste: Política nega**
  - [ ] Request com identity inválida → 403
  - [ ] Verificar ledger: `action.v1` com `did = "policy.evaluate"`, `decision = "deny"`

**Deliverable:** Policy Engine integrado no Worker MVP-1

---

## 📋 FASE 3: Office Tools (1 semana) — Opcional para MVP-1

### 3.1 Adicionar Office Tools ao MCP

- [ ] **Adicionar tools ao `tools/list`:**
  - [ ] `office.document.create`
  - [ ] `office.document.get`
  - [ ] `office.document.search`
  - [ ] `office.llm.complete`

- [ ] **Implementar handlers:**
  - [ ] `handleOfficeDocumentCreate(env, identity, args)` → Response
  - [ ] `handleOfficeDocumentGet(env, identity, args)` → Response
  - [ ] `handleOfficeDocumentSearch(env, identity, args)` → Response
  - [ ] `handleOfficeLLMComplete(env, identity, args)` → Response

### 3.2 Implementar WorkspaceObject (Durable Object)

- [ ] **Criar `src/durable-objects/WorkspaceObject.ts`**
  - [ ] Classe `WorkspaceObject` extends `DurableObject`
  - [ ] Storage keys: `config`, `documents`
  - [ ] Métodos:
    - [ ] `createDocument({content}, identity)` → document
    - [ ] `getDocument(doc_id, identity)` → document
    - [ ] `searchDocuments({query}, identity)` → documents[]

- [ ] **Criar WorkspaceAgreement**
  - [ ] Quando workspace é criado: criar WorkspaceAgreement
  - [ ] Agreement ID: `a:workspace:<workspace_id>`

### 3.3 Integrar com UBL Ledger

- [ ] **Emitir receipts para operações Office**
  - [ ] `office.document.create` → emitir `action.v1` + `effect.v1`
  - [ ] `office.llm.complete` → emitir `action.v1` + `effect.v1`
  - [ ] Referenciar WorkspaceAgreement em `action.v1.agreement_id`

- [ ] **Integrar AI Gateway (para `office.llm.complete`)**
  - [ ] Rotear chamadas LLM via AI Gateway
  - [ ] Emitir receipt para cada chamada LLM

**Deliverable:** Office tools funcionando no Worker MVP-1 (opcional)

---

## 📋 FASE 4: Validação e Finalização (1 semana)

### 4.1 Validação End-to-End

- [ ] **Teste: iPhone PWA**
  - [ ] Abrir PWA no iPhone
  - [ ] Login via Access
  - [ ] Enviar mensagem
  - [ ] Verificar `room_seq` e `receipt.seq` na UI
  - [ ] Verificar SSE stream funcionando

- [ ] **Teste: MCP via Portal URL**
  - [ ] Conectar via `mcp-remote@latest` usando portal URL
  - [ ] `initialize` → deve funcionar
  - [ ] `tools/list` → deve listar tools
  - [ ] `tools/call messenger.send` → deve funcionar
  - [ ] Verificar que mensagem aparece no iPhone PWA via SSE

- [ ] **Teste: Receipt Lookup**
  - [ ] `GET /api/receipts/<seq>` → deve retornar `action.v1` + `effect.v1`
  - [ ] Verificar hash chain: `head_hash` calculado corretamente
  - [ ] Verificar `ref_action_cid` em `effect.v1` aponta para `action.v1.cid`

- [ ] **Teste: Portal Logs**
  - [ ] Fazer tool call via portal
  - [ ] Cloudflare Dashboard → Portal logs
  - [ ] Verificar: Capability = `messenger.send`
  - [ ] Verificar: Server, duration, status

### 4.2 Proof of Done Checklist

- [ ] Portal URL funciona como único endpoint MCP
- [ ] `messenger.send` retorna `{room_seq, receipt:{seq,cid,head_hash}}`
- [ ] `GET /api/events/rooms/:id` emite `message.created` com `id == room_seq`
- [ ] `GET /api/receipts/:seq` retorna atoms que reproduzem hash chain head
- [ ] Origin validation enforced (403 on mismatch)
- [ ] MCP usa Streamable HTTP (não SSE)
- [ ] SSE apenas para Messenger room streams
- [ ] Agreement-first: todos `action.v1` têm `agreement_id`
- [ ] Hash chain válido: `head_hash` calculado corretamente
- [ ] Triple-entry bookkeeping: Portal log ↔ receipt ↔ room timeline

### 4.3 Documentação

- [ ] **Atualizar README.md**
  - [ ] Adicionar seção sobre MVP-1
  - [ ] Documentar endpoints REST
  - [ ] Documentar MCP tools
  - [ ] Documentar como conectar via portal

- [ ] **Documentar endpoints**
  - [ ] Criar `docs/API.md` com todos os endpoints
  - [ ] Incluir exemplos de request/response

- [ ] **Documentar MCP tools**
  - [ ] Criar `docs/MCP.md` com todos os tools
  - [ ] Incluir schemas JSON

**Deliverable:** MVP-1 validado e documentado

---

## 📊 Timeline

**MVP-1 (Single Worker): 4-5 semanas**

- Fase 0: 1 semana (preparação)
- Fase 1: 2-3 semanas (MVP-1 Single Worker completo)
- Fase 2: 1 semana (Policy Engine integration)
- Fase 3: 1 semana (Office tools — opcional)
- Fase 4: 1 semana (validação e finalização)

---

## 🚀 MVP-1 Rápido (4 semanas)

Se você quer MVP-1 funcionando rápido:

**Semana 1: Preparação + Estrutura**
- Fase 0 completa
- Criar `workers/ubl-mvp1`
- D1 + R2 criados
- Estrutura básica

**Semana 2: Core + DOs**
- 3 Durable Objects implementados
- REST endpoints básicos
- SSE para Messenger
- Hash chain implementado

**Semana 3: MCP + Agreements**
- `/mcp` endpoint (Streamable HTTP)
- MCP tools implementados
- Origin validation
- Agreement tracking

**Semana 4: Portal + Validação**
- MCP Server Portal criado
- Access configurado
- Testes end-to-end
- Proof of Done validado

---

## ✅ Checklist Consolidado

### Preparação (Fase 0)
- [ ] Backup de dados críticos
- [ ] Desativar workers antigos
- [ ] Limpar recursos não usados
- [ ] Preparar estrutura nova

### Construção (Fase 1)
- [ ] Provisionar D1 + R2
- [ ] Implementar canonicalization + hash chain
- [ ] Implementar 3 Durable Objects
- [ ] Implementar Agreement tracking
- [ ] Implementar REST endpoints
- [ ] Implementar SSE stream
- [ ] Implementar MCP server
- [ ] Configurar Access
- [ ] Configurar MCP Portal
- [ ] Testes básicos

### Integração (Fase 2)
- [ ] Policy Engine integrado
- [ ] Cache de políticas
- [ ] Testes de política

### Office (Fase 3 - Opcional)
- [ ] Office tools adicionados
- [ ] WorkspaceObject implementado
- [ ] Integração com UBL Ledger

### Validação (Fase 4)
- [ ] Validação end-to-end
- [ ] Proof of Done completo
- [ ] Documentação completa

---

**Última atualização:** 2026-01-07
