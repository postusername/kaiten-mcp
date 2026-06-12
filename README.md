# kaiten-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes the full [Kaiten](https://kaiten.ru) project management API as **66 callable tools** — spaces, boards, cards, documents, users, sprints, and more.

## Requirements

- Node.js ≥ 18 (uses native `fetch`)
- A Kaiten account with API token

## Installation

```bash
git clone https://github.com/postusername/kaiten-mcp.git
cd kaiten-mcp
npm install
```

## Configuration

Two environment variables are required:

| Variable | Description | Example |
|---|---|---|
| `KAITEN_DOMAIN` | Your Kaiten subdomain (without `.kaiten.ru`) | `mycompany` |
| `KAITEN_TOKEN` | API token from Kaiten profile → Settings → API Keys | `abc123...` |

Obtain your token: Kaiten → Profile → Settings → API Keys → Generate.

## Usage

### Claude Code — standalone (recommended for this repo)

When you open the `kaiten-mcp` folder directly, Claude Code auto-loads `.mcp.json` and starts the server via `node index.js`. Just set the two environment variables and approve the server on first run.

Export the variables before launching Claude Code:

```bash
export KAITEN_TOKEN=your_api_token_here
export KAITEN_DOMAIN=yourcompany   # subdomain only, without .kaiten.ru
```

Or place them in a `.env` file and run `source .env` first.

**Manual project-scope registration** — create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "kaiten": {
      "command": "node",
      "args": ["/absolute/path/to/kaiten-mcp/index.js"],
      "env": {
        "KAITEN_TOKEN": "your_api_token_here",
        "KAITEN_DOMAIN": "yourcompany"
      }
    }
  }
}
```

**User scope** — available across all projects:

```bash
claude mcp add kaiten \
  -s user \
  -e KAITEN_TOKEN=your_token \
  -e KAITEN_DOMAIN=yourcompany \
  -- node /absolute/path/to/kaiten-mcp/index.js
```

After registration, all `kaiten_*` tools are available in Claude Code conversations.

### Docker — HTTP/SSE transport

The server supports an HTTP/SSE transport mode for use in containerised environments. Set `MCP_HTTP_PORT` to start it as an SSE server instead of stdio:

```bash
docker build -t kaiten-mcp .
docker run --rm -p 3000:3000 \
  -e KAITEN_TOKEN=your_token \
  -e KAITEN_DOMAIN=yourcompany \
  -e MCP_HTTP_PORT=3000 \
  kaiten-mcp
```

The SSE endpoint is then available at `http://localhost:3000/sse`.

**Note:** if you are using [aura-rag](https://github.com/postusername/aura-rag), kaiten-mcp is already included as a service in its `docker-compose.yml`. Run `docker compose up -d` in the aura-rag directory — no need to start kaiten-mcp separately. Both MCP servers (kaiten + rag) are registered automatically when you open the aura-rag project.

### Stdio smoke test

```bash
# List all 66 available tools
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

## Available Tools (66 total)

### Authentication
- `kaiten_get_current_user` — verify token, get own profile

### Spaces
- `kaiten_list_spaces` — list all spaces
- `kaiten_get_space` — get space by ID
- `kaiten_create_space` — create space
- `kaiten_update_space` / `kaiten_delete_space`
- `kaiten_list_space_users` / `kaiten_invite_user_to_space`

### Boards
- `kaiten_list_boards` — list boards (filter by space_id)
- `kaiten_get_board` — get board with columns and lanes
- `kaiten_create_board` / `kaiten_update_board` / `kaiten_delete_board`

### Columns & Lanes
- `kaiten_list_columns` / `kaiten_create_column` / `kaiten_update_column` / `kaiten_delete_column`
- `kaiten_list_lanes` / `kaiten_create_lane` / `kaiten_update_lane` / `kaiten_delete_lane`

### Cards
- `kaiten_list_cards` — filter by board_id, column_id, lane_id; supports limit/offset
- `kaiten_get_card` — full card details
- `kaiten_create_card` — title, description, column, lane, deadline, priority (0–4), size, owner
- `kaiten_update_card` / `kaiten_move_card` / `kaiten_delete_card`

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
- `kaiten_upload_document_image` — upload an image and get its `src` URL for embedding
- `kaiten_list_document_groups` / `kaiten_create_document_group`

### Document Conversations (inline comments)
- `kaiten_list_document_conversations` — list comment threads anchored to text fragments
- `kaiten_create_document_conversation` — start a new thread: anchors an `annotation` mark to an exact text fragment (highlighted in Kaiten UI) and posts the first message
- `kaiten_add_document_conversation_message` — reply to an existing thread
- `kaiten_resolve_document_conversation` — resolve or reopen a thread

### Users
- `kaiten_list_users` / `kaiten_get_user`

### Sprints
- `kaiten_list_sprints` / `kaiten_create_sprint` / `kaiten_update_sprint`

### Other
- `kaiten_list_custom_properties` — custom card properties for a space
- `kaiten_list_audit_logs` — company-level audit trail

## Card Priority Values

| Value | Meaning |
|---|---|
| 0 | None |
| 1 | Low |
| 2 | Medium |
| 3 | High |
| 4 | Critical |

## Notes

- **`KAITEN_DOMAIN` is the subdomain only**: `mycompany`, not `mycompany.kaiten.ru`
- **Rate limit**: 5 req/s — add delays between bulk operations to avoid 429 errors
- **ESM only**: `package.json` uses `"type": "module"` — do not use `require()`
- **Token expiry**: tokens do not expire by default but can be revoked from the profile page
- **Inline comments on fresh documents**: Kaiten rejects `annotation` marks added via API to documents that have never had inline comments (500 or silent strip). `kaiten_create_document_conversation` detects this and fails with a hint — add one comment in the Kaiten UI first, after that the API path works

## License

ISC
