# kaiten-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes the full [Kaiten](https://kaiten.ru) project management API as **61 callable tools** — spaces, boards, cards, documents, users, sprints, and more.

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

### Claude Code (recommended)

**Project scope** — create `.mcp.json` in your project root (not inside `.claude/`):

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

Then approve it in Claude Code (shown as ⏸ Pending on first run) or pre-approve via:

```bash
claude mcp get kaiten
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

### Stdio smoke test

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

## Available Tools (61 total)

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
- `kaiten_list_document_groups` / `kaiten_create_document_group`

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

## License

ISC
