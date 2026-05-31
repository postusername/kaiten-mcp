---
name: run-kaiten-mcp
description: Run, configure, and test the Kaiten MCP server. Use this skill to start the server, call Kaiten API tools, debug connections, or add to Claude Code MCP config.
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
