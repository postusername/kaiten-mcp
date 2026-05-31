#!/usr/bin/env bash
# Smoke test for kaiten-mcp server.
# Usage: KAITEN_TOKEN=xxx KAITEN_DOMAIN=yourcompany bash smoke.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."   # go to kaiten-mcp root

if [[ -z "${KAITEN_TOKEN:-}" || -z "${KAITEN_DOMAIN:-}" ]]; then
  echo "Error: set KAITEN_TOKEN and KAITEN_DOMAIN before running"
  exit 1
fi

run_tool() {
  local name="$1"
  local args="${2:-{}}"
  local payload="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}"
  echo "$payload" | KAITEN_TOKEN="$KAITEN_TOKEN" KAITEN_DOMAIN="$KAITEN_DOMAIN" timeout 10 node index.js
}

echo "=== 1. Listing tools ==="
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | KAITEN_TOKEN="$KAITEN_TOKEN" KAITEN_DOMAIN="$KAITEN_DOMAIN" timeout 5 node index.js \
  | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(len(d['result']['tools']), 'tools registered')"

echo ""
echo "=== 2. Current user ==="
run_tool "kaiten_get_current_user" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
c = d.get('result', {}).get('content', [{}])[0].get('text', '')
if 'Error' in c:
    print('FAIL:', c)
else:
    u = json.loads(c)
    print('OK: logged in as', u.get('full_name') or u.get('email') or 'unknown')
"

echo ""
echo "=== 3. List spaces ==="
run_tool "kaiten_list_spaces" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
c = d.get('result', {}).get('content', [{}])[0].get('text', '')
if 'Error' in c:
    print('FAIL:', c)
else:
    spaces = json.loads(c)
    count = len(spaces) if isinstance(spaces, list) else '?'
    print(f'OK: {count} spaces found')
"

echo ""
echo "All smoke tests passed."
