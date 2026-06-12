---
name: run-kaiten-mcp
description: Run, configure, and test the Kaiten MCP server. Use for starting the server, calling Kaiten API tools, editing documents via markdown, debugging connections, or Claude Code MCP config.
---

# Kaiten MCP Server

A Model Context Protocol server that exposes the full Kaiten project management API (spaces, boards, cards, documents, users, and more) as 61 callable tools.

The server communicates over **stdio** and is driven by piping JSON-RPC 2.0 messages to it — or by registering it in `.claude/mcp.json` for automatic tool availability in Claude Code.

---

## Prerequisites

```bash
cd kaiten-mcp
npm install        # installs @modelcontextprotocol/sdk and zod
```

Requires Node.js ≥ 18 (uses native `fetch`).

---

## Configuration

Two environment variables are required:

| Variable | Description | Example |
|---|---|---|
| `KAITEN_DOMAIN` | Your Kaiten subdomain (without `.kaiten.ru`) | `mycompany` |
| `KAITEN_TOKEN` | API token from Kaiten profile → API Keys | `abc123...` |

Obtain your token: Kaiten → Profile → Settings → API Keys → Generate.

---

## Run (agent path) — stdio smoke test

Pipe JSON-RPC messages directly to verify the server works:

```bash
# List all 61 available tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | KAITEN_TOKEN=your_token KAITEN_DOMAIN=yourcompany node index.js \
  | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(len(d['result']['tools']), 'tools')"

# Get current authenticated user
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kaiten_get_current_user","arguments":{}}}' \
  | KAITEN_TOKEN=your_token KAITEN_DOMAIN=yourcompany node index.js

# List all spaces
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kaiten_list_spaces","arguments":{}}}' \
  | KAITEN_TOKEN=your_token KAITEN_DOMAIN=yourcompany node index.js
```

The driver script at `.claude/skills/run-kaiten-mcp/smoke.sh` automates these checks.

---

## Run (Claude Code — this folder)

When this `kaiten-mcp` folder is opened in Claude Code, the included `.mcp.json` auto-registers the server via `node index.js` (stdio). Just export the two env vars before opening:

```bash
export KAITEN_TOKEN=your_token
export KAITEN_DOMAIN=yourcompany
```

Or register globally via Claude Code CLI:

```bash
claude mcp add kaiten \
  --command "node /absolute/path/to/kaiten-mcp/index.js" \
  --env KAITEN_TOKEN=your_token \
  --env KAITEN_DOMAIN=yourcompany
```

## Run (Docker — HTTP/SSE transport)

For containerised use, set `MCP_HTTP_PORT` to start in SSE mode instead of stdio:

```bash
docker build -t kaiten-mcp .
docker run --rm -p 3000:3000 \
  -e KAITEN_TOKEN=your_token \
  -e KAITEN_DOMAIN=yourcompany \
  -e MCP_HTTP_PORT=3000 \
  kaiten-mcp
# SSE endpoint: http://localhost:3000/sse
```

If you use **aura-rag**, kaiten-mcp is already included in its `docker-compose.yml` — `docker compose up -d` starts both servers. Opening the aura-rag project connects Claude Code to both automatically.

---

## Available Tools (61 total)

### Authentication
- `kaiten_get_current_user` — verify token, get own profile

### Spaces
- `kaiten_list_spaces` — list all spaces
- `kaiten_get_space` — get space by ID
- `kaiten_create_space` — create space (title, description)
- `kaiten_update_space` — update space
- `kaiten_delete_space` — delete space
- `kaiten_list_space_users` — list users in a space
- `kaiten_invite_user_to_space` — invite user to space

### Boards
- `kaiten_list_boards` — list boards (filter by space_id)
- `kaiten_get_board` — get board with columns and lanes
- `kaiten_create_board` — create board in a space
- `kaiten_update_board` / `kaiten_delete_board`

### Columns & Lanes
- `kaiten_list_columns` / `kaiten_create_column` / `kaiten_update_column` / `kaiten_delete_column`
- `kaiten_list_lanes` / `kaiten_create_lane` / `kaiten_update_lane` / `kaiten_delete_lane`

### Cards
- `kaiten_list_cards` — filter by board_id, column_id, lane_id; supports limit/offset
- `kaiten_get_card` — full card details
- `kaiten_create_card` — title, description, column, lane, deadline, priority (0-4), size, owner
- `kaiten_update_card` — any card field
- `kaiten_move_card` — change column/lane
- `kaiten_delete_card`

### Card Members & Tags
- `kaiten_add_card_member` / `kaiten_remove_card_member`
- `kaiten_add_card_tag` / `kaiten_remove_card_tag`

### Card Comments
- `kaiten_list_card_comments` / `kaiten_create_card_comment` / `kaiten_update_card_comment` / `kaiten_delete_card_comment`

### Card Checklists
- `kaiten_list_card_checklists` / `kaiten_create_card_checklist`
- `kaiten_create_checklist_item` / `kaiten_update_checklist_item`

### Card Time Logs
- `kaiten_list_card_time_logs` / `kaiten_create_card_time_log` / `kaiten_update_card_time_log` / `kaiten_delete_card_time_log`

### Card Blockers & Children
- `kaiten_list_card_blockers` / `kaiten_create_card_blocker` / `kaiten_delete_card_blocker`
- `kaiten_list_card_children`

### Documents
- `kaiten_list_documents` / `kaiten_get_document` / `kaiten_create_document` / `kaiten_update_document` / `kaiten_delete_document`
- `kaiten_list_document_groups` / `kaiten_create_document_group`

### Users
- `kaiten_list_users` / `kaiten_get_user`

### Sprints
- `kaiten_list_sprints` / `kaiten_create_sprint` / `kaiten_update_sprint`

### Other
- `kaiten_list_custom_properties` — custom card properties for a space
- `kaiten_list_audit_logs` — company-level audit trail

---

## Priority values for cards

| Value | Meaning |
|---|---|
| 0 | None |
| 1 | Low |
| 2 | Medium |
| 3 | High |
| 4 | Critical |

---

## Gotchas

- **KAITEN_DOMAIN is the subdomain only**: `mycompany`, not `mycompany.kaiten.ru`
- **Rate limit**: 5 req/s; rapid batch operations may hit 429. Add delays between bulk calls.
- **Card move vs update**: `kaiten_move_card` and `kaiten_update_card` both PATCH `/cards/{id}` — they're the same endpoint. `move_card` is a named alias for clarity.
- **Token expiry**: Kaiten API tokens do not expire by default but can be revoked from the profile page.
- **ESM only**: `package.json` uses `"type": "module"`. Do not use `require()`.
- **Document `id` is a UUID string** (`e164d68e-…`), not a numeric id — older tool schemas said `number`, API accepts uid.

---

## Editing Kaiten documents (agent playbook)

Lessons from production edits (large specs, PDF sync, glossary passes).

### Find the document

| Approach | When |
|---|---|
| `kaiten_list_documents` → `kaiten_get_document` | **Preferred** — always works for docs you have access to |
| `rag_query` | Only if doc is indexed in RAG; **new/recent docs often missing** |

Do not assume RAG found the canonical doc. Title search in `kaiten_list_documents` is reliable.

### Before writing anything

1. **`kaiten_get_document`** — mandatory. Save `data`, `sort_order`, `updated`.
2. **Never blind full-replace** from an old draft, plan, or memory — the live doc may have manual edits (shorter §10, glossary tweaks, inline comments).
3. For partial updates: extract unchanged sections from current `data` (GET → markdown or ProseMirror walk), patch only target §, merge, then upload.

### `kaiten_update_document` behaviour

- `content` **replaces the entire body** — no section-level PATCH.
- Markdown is converted to ProseMirror JSON via `markdownToKaitenDoc` (lossy round-trip).
- Tool auto-preserves `sort_order` from GET if you omit it; still GET first.
- Embedded images: keep existing `![alt](https://files/<doc-uid>/…)` URLs on their own line, or re-upload via `kaiten_upload_document_image`.

### Inline annotations (review comments)

Kaiten stores review anchors as ProseMirror **`annotation` marks** on text nodes. **`kaiten_update_document` drops them** on markdown conversion.

**After every body replace:**

1. Keep `oldPm = JSON.parse(doc.data)` from GET **before** PATCH.
2. Convert markdown → `newPm`.
3. Run `restoreAnnotations(oldPm, newPm)` from `lib/restore-annotations.js` (match by **exact** annotated text).
4. PATCH `{ data: newPm, sort_order }`.
5. Verify: `doc.data` still contains `"annotation"`.

**CLI (recommended for large docs):**

```bash
cd kaiten-mcp
source ../.env   # KAITEN_TOKEN, KAITEN_DOMAIN
node scripts/update-document-from-markdown.mjs <doc-uuid> path/to/merged.md
```

Prints `{ annotations_restored: N }`. If `N === 0` but comments existed, annotated text changed — restore manually in UI or fix matching strings.

Read threads: `kaiten_list_document_conversations` (`block_uid` ↔ annotation mark `id`).

### Markdown converter limits

Avoid constructs that render badly or break tables:

| OK | Avoid |
|---|---|
| `##` / `###` headings | `#` alone (mapped to heading2 anyway) |
| `**bold**`, `*em*`, `` `code` `` | Nested `**bold with *em* inside**` in table cells |
| `![alt](url)` on its own line | Inline images mid-paragraph |
| `\|` escaped in tables | Unescaped `\|` in cell text |
| One blank line between blocks | `**Label **`**`params.txt`**`**` style double-bold |

### Safe edit workflow (checklist)

```
GET document
  → note manual diffs vs your draft
  → save oldPm for annotations
Edit markdown (merged full body OR section patch)
  → preserve image URLs from GET
  → grep glossary terms used ≥2× in body
update-document-from-markdown.mjs  (or MCP + manual restoreAnnotations)
  → verify key strings (e.g. table_height_cm, examples)
  → verify annotations_restored > 0 if doc had comments
Optional: rag_sync if doc is in RAG domain
```

### Glossary / terminology passes

If the doc has §2 glossary: terms must appear in body, not only in tables. Replace repeated long phrases (`params.txt` everywhere) with the glossary term where it clarifies — keep `params.txt` in format/code sections.

---

## Troubleshooting

**`KAITEN_TOKEN and KAITEN_DOMAIN environment variables are required`**
→ Export both vars before running, or pass them inline.

**`Error: fetch failed`**
→ The domain is unreachable. Check `KAITEN_DOMAIN` spelling and network access.

**`401 Unauthorized`**
→ Token is invalid or revoked. Generate a new one in Kaiten profile settings.

**`429 Too Many Requests`**
→ Slow down — the Kaiten API allows 5 req/s. Check `X-RateLimit-Reset` header for reset time.

**Server exits immediately with no output**
→ No JSON-RPC input on stdin. The server waits for stdin — pipe messages to it.

**Document update dropped inline comments / yellow highlights**
→ Expected with markdown-only `kaiten_update_document`. Use `scripts/update-document-from-markdown.mjs` or call `restoreAnnotations` after conversion.

**`annotations_restored: 0` but doc had comments**
→ Annotated phrase text changed in edit (e.g. removed «⚠️ уточнить…»). Re-add comments in Kaiten UI or keep anchor text identical.

**Large markdown fails via MCP tool**
→ Use CLI script with `.env` instead of inline MCP payload.

**Accidentally wiped a document while testing the update script**
→ Script replaces full body — never test with `# test` on a production uid. Restore from prior GET backup or Kaiten version history; re-apply `restoreAnnotations` from a JSON snapshot that still has `annotation` marks.

**Document body duplicated (2×/3× copies of all content) after API edits**
→ The document was open in the Kaiten UI: the collab-editor session periodically saves its stale state on top of REST PATCHes, concatenating full copies (e.g. 174 → 348 → 522 blocks). **Always have the document closed in the UI before editing `data` via API.** To repair: GET, slice `content` to the latest full copy (it carries the newest annotation marks), PATCH it back, then re-GET ~2 min later to confirm the block count stays put before making further edits.

**Annotation marks rejected on a never-commented document (500 or silently stripped)**
→ Kaiten only accepts new `annotation` marks via REST on documents that already contain at least one. Seed the first inline comment in the Kaiten UI, then `kaiten_create_document_conversation` works.
