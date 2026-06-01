import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const KAITEN_TOKEN = process.env.KAITEN_TOKEN;
const KAITEN_DOMAIN = process.env.KAITEN_DOMAIN;

if (!KAITEN_TOKEN || !KAITEN_DOMAIN) {
  console.error(
    "Error: KAITEN_TOKEN and KAITEN_DOMAIN environment variables are required.\n" +
    "Example: KAITEN_DOMAIN=mycompany KAITEN_TOKEN=your_token node index.js"
  );
  process.exit(1);
}

const BASE_URL = `https://${KAITEN_DOMAIN}.kaiten.ru/api/v1`;

async function kaitenRequest(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${KAITEN_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kaiten API ${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ───── Markdown → Kaiten ProseMirror converter ─────
// Kaiten stores document body in `data` as ProseMirror JSON with a custom schema:
//   headings: heading2 (md #/##) / heading3 (md ###+), attrs {textAlign, id}
//   paragraph attrs {textAlign}; marks: strong, em, code, link({href})
//   table(size:fixed) > table_row > table_header|table_cell(colspan/rowspan) > paragraph
//   bullet_list > list_item > paragraph; blockquote > paragraph
//   horizontal_rule; code_block attrs {language, lineNumbers}
function mdSlug(text) {
  return (
    String(text).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^0-9a-zа-яё._-]/gi, "") +
    "-" +
    Math.floor(Math.random() * 1e8)
  );
}

function mdTextNode(text, marks) {
  const n = { type: "text", text };
  if (marks && marks.length) n.marks = marks;
  return n;
}

function mdParseInline(text, marks = []) {
  if (!text) return [];
  const patterns = [
    { kind: "code", re: /`([^`]+)`/ },
    { kind: "strong", re: /\*\*([^*]+)\*\*/ },
    { kind: "strong", re: /__([^_]+)__/ },
    { kind: "em", re: /\*([^*]+)\*/ },
    { kind: "em", re: /(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/ },
    { kind: "link", re: /\[([^\]]+)\]\(([^)]+)\)/ },
  ];
  let best = null;
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m && (!best || m.index < best.m.index)) best = { p, m };
  }
  if (!best) return [mdTextNode(text, marks.length ? marks : undefined)];
  const { p, m } = best;
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  let mid;
  if (p.kind === "code") {
    mid = [mdTextNode(m[1], marks.concat([{ type: "code", attrs: {} }]))];
  } else if (p.kind === "link") {
    mid = [mdTextNode(m[1], marks.concat([{ type: "link", attrs: { href: m[2] } }]))];
  } else {
    mid = mdParseInline(m[1], marks.concat([{ type: p.kind, attrs: {} }]));
  }
  return [
    ...(before ? mdParseInline(before, marks) : []),
    ...mid,
    ...(after ? mdParseInline(after, marks) : []),
  ];
}

function mdParagraph(text) {
  return { type: "paragraph", attrs: { textAlign: "left" }, content: mdParseInline(text) };
}

function mdTableCell(text, header) {
  return {
    type: header ? "table_header" : "table_cell",
    attrs: { colspan: 1, rowspan: 1 },
    content: [mdParagraph(text.trim())],
  };
}

function mdSplitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|") { cells.push(cur); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur);
  return cells;
}

const MD_TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function markdownToKaitenDoc(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const content = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // fenced code block
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      const language = fence[1].trim() || null;
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      content.push({
        type: "code_block",
        attrs: { language, lineNumbers: false },
        content: buf.length ? [{ type: "text", text: buf.join("\n") }] : [],
      });
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      content.push({ type: "horizontal_rule" });
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const type = level <= 2 ? "heading2" : "heading3";
      const text = h[2].trim();
      content.push({ type, attrs: { textAlign: "left", id: mdSlug(text) }, content: mdParseInline(text) });
      i++;
      continue;
    }

    // table
    if (line.includes("|") && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) {
      const header = mdSplitRow(line);
      i += 2;
      const rows = [
        { type: "table_row", content: header.map((c) => mdTableCell(c, true)) },
      ];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const cells = mdSplitRow(lines[i]);
        rows.push({ type: "table_row", content: cells.map((c) => mdTableCell(c, false)) });
        i++;
      }
      content.push({ type: "table", attrs: { size: "fixed" }, content: rows });
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      content.push({ type: "blockquote", content: [mdParagraph(buf.join(" ").trim())] });
      continue;
    }

    // bullet / ordered list (both rendered as bullet_list to stay within known schema)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        items.push({ type: "list_item", content: [mdParagraph(text)] });
        i++;
      }
      content.push({ type: "bullet_list", content: items });
      continue;
    }

    // paragraph (gather consecutive non-blank, non-block lines)
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    content.push(mdParagraph(buf.join(" ")));
  }

  return { type: "doc", content: content.length ? content : [{ type: "paragraph", attrs: { textAlign: "left" } }] };
}

const tools = [
  // ───── AUTH / CURRENT USER ─────
  {
    name: "kaiten_get_current_user",
    description: "Get information about the currently authenticated user",
    inputSchema: { type: "object", properties: {}, required: [] },
  },

  // ───── SPACES ─────
  {
    name: "kaiten_list_spaces",
    description: "List all spaces available in the workspace",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kaiten_get_space",
    description: "Get a specific space by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Space ID" } },
      required: ["id"],
    },
  },
  {
    name: "kaiten_create_space",
    description: "Create a new space",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Space title" },
        description: { type: "string", description: "Space description" },
      },
      required: ["title"],
    },
  },
  {
    name: "kaiten_update_space",
    description: "Update an existing space",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Space ID" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "kaiten_delete_space",
    description: "Delete a space by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Space ID" } },
      required: ["id"],
    },
  },

  // ───── SPACE USERS ─────
  {
    name: "kaiten_list_space_users",
    description: "List all users in a space",
    inputSchema: {
      type: "object",
      properties: { space_id: { type: "number", description: "Space ID" } },
      required: ["space_id"],
    },
  },
  {
    name: "kaiten_invite_user_to_space",
    description: "Invite a user to a space",
    inputSchema: {
      type: "object",
      properties: {
        space_id: { type: "number", description: "Space ID" },
        user_id: { type: "number", description: "User ID to invite" },
        role_id: { type: "number", description: "Role ID to assign" },
      },
      required: ["space_id", "user_id"],
    },
  },

  // ───── BOARDS ─────
  {
    name: "kaiten_list_boards",
    description: "List all boards. Optionally filter by space_id.",
    inputSchema: {
      type: "object",
      properties: {
        space_id: { type: "number", description: "Filter by space ID" },
      },
      required: [],
    },
  },
  {
    name: "kaiten_get_board",
    description: "Get a specific board by ID with full details (columns, lanes)",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Board ID" } },
      required: ["id"],
    },
  },
  {
    name: "kaiten_create_board",
    description: "Create a new board (space-board) inside a space",
    inputSchema: {
      type: "object",
      properties: {
        space_id: { type: "number", description: "Parent space ID" },
        title: { type: "string", description: "Board title" },
      },
      required: ["space_id", "title"],
    },
  },
  {
    name: "kaiten_update_board",
    description: "Update a board",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Board ID" },
        title: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "kaiten_delete_board",
    description: "Delete a board by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Board ID" } },
      required: ["id"],
    },
  },

  // ───── COLUMNS ─────
  {
    name: "kaiten_list_columns",
    description: "List columns for a board",
    inputSchema: {
      type: "object",
      properties: { board_id: { type: "number", description: "Board ID" } },
      required: ["board_id"],
    },
  },
  {
    name: "kaiten_create_column",
    description: "Create a column on a board",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "Board ID" },
        title: { type: "string", description: "Column title" },
        sort_order: { type: "number", description: "Position (sort order)" },
      },
      required: ["board_id", "title"],
    },
  },
  {
    name: "kaiten_update_column",
    description: "Update a column",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Column ID" },
        title: { type: "string" },
        sort_order: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "kaiten_delete_column",
    description: "Delete a column",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Column ID" } },
      required: ["id"],
    },
  },

  // ───── LANES ─────
  {
    name: "kaiten_list_lanes",
    description: "List lanes (swimlanes) for a board",
    inputSchema: {
      type: "object",
      properties: { board_id: { type: "number", description: "Board ID" } },
      required: ["board_id"],
    },
  },
  {
    name: "kaiten_create_lane",
    description: "Create a lane (swimlane) on a board",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "Board ID" },
        title: { type: "string", description: "Lane title" },
        sort_order: { type: "number", description: "Position" },
      },
      required: ["board_id", "title"],
    },
  },
  {
    name: "kaiten_update_lane",
    description: "Update a lane",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Lane ID" },
        title: { type: "string" },
        sort_order: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "kaiten_delete_lane",
    description: "Delete a lane",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Lane ID" } },
      required: ["id"],
    },
  },

  // ───── CARDS ─────
  {
    name: "kaiten_list_cards",
    description:
      "List cards. Filter by board_id, column_id, lane_id, or member_ids.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "number" },
        column_id: { type: "number" },
        lane_id: { type: "number" },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: [],
    },
  },
  {
    name: "kaiten_get_card",
    description: "Get full details of a card by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Card ID" } },
      required: ["id"],
    },
  },
  {
    name: "kaiten_create_card",
    description: "Create a new card on a board",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "Board ID (required)" },
        column_id: { type: "number", description: "Column ID" },
        lane_id: { type: "number", description: "Lane ID" },
        title: { type: "string", description: "Card title" },
        description: { type: "string", description: "Card description (markdown)" },
        size: { type: "number", description: "Story points / effort estimate" },
        deadline: { type: "string", description: "Deadline date (ISO 8601)" },
        priority: { type: "number", description: "Priority (0=none, 1=low, 2=medium, 3=high, 4=critical)" },
        type_id: { type: "number", description: "Card type ID" },
        owner_id: { type: "number", description: "Owner user ID" },
      },
      required: ["board_id", "title"],
    },
  },
  {
    name: "kaiten_update_card",
    description: "Update a card (title, description, column, lane, deadline, priority, size, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Card ID" },
        title: { type: "string" },
        description: { type: "string" },
        column_id: { type: "number" },
        lane_id: { type: "number" },
        size: { type: "number" },
        deadline: { type: "string" },
        priority: { type: "number" },
        type_id: { type: "number" },
        owner_id: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "kaiten_delete_card",
    description: "Delete a card by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Card ID" } },
      required: ["id"],
    },
  },
  {
    name: "kaiten_move_card",
    description: "Move a card to a different column and/or lane",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Card ID" },
        column_id: { type: "number", description: "Target column ID" },
        lane_id: { type: "number", description: "Target lane ID" },
        sort_order: { type: "number", description: "Position within column" },
      },
      required: ["id", "column_id"],
    },
  },

  // ───── CARD MEMBERS ─────
  {
    name: "kaiten_add_card_member",
    description: "Add a member (user) to a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        user_id: { type: "number", description: "User ID to add" },
      },
      required: ["card_id", "user_id"],
    },
  },
  {
    name: "kaiten_remove_card_member",
    description: "Remove a member from a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        user_id: { type: "number", description: "User ID to remove" },
      },
      required: ["card_id", "user_id"],
    },
  },

  // ───── CARD TAGS ─────
  {
    name: "kaiten_add_card_tag",
    description: "Add a tag to a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        tag_id: { type: "number", description: "Tag ID" },
      },
      required: ["card_id", "tag_id"],
    },
  },
  {
    name: "kaiten_remove_card_tag",
    description: "Remove a tag from a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        tag_id: { type: "number", description: "Tag ID" },
      },
      required: ["card_id", "tag_id"],
    },
  },

  // ───── CARD COMMENTS ─────
  {
    name: "kaiten_list_card_comments",
    description: "List all comments on a card",
    inputSchema: {
      type: "object",
      properties: { card_id: { type: "number", description: "Card ID" } },
      required: ["card_id"],
    },
  },
  {
    name: "kaiten_create_card_comment",
    description: "Add a comment to a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        text: { type: "string", description: "Comment text (markdown supported)" },
      },
      required: ["card_id", "text"],
    },
  },
  {
    name: "kaiten_update_card_comment",
    description: "Update an existing comment on a card",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Comment ID" },
        text: { type: "string", description: "New comment text" },
      },
      required: ["id", "text"],
    },
  },
  {
    name: "kaiten_delete_card_comment",
    description: "Delete a comment from a card",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Comment ID" } },
      required: ["id"],
    },
  },

  // ───── CARD CHECKLISTS ─────
  {
    name: "kaiten_list_card_checklists",
    description: "List all checklists attached to a card",
    inputSchema: {
      type: "object",
      properties: { card_id: { type: "number", description: "Card ID" } },
      required: ["card_id"],
    },
  },
  {
    name: "kaiten_create_card_checklist",
    description: "Add a checklist to a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        title: { type: "string", description: "Checklist title" },
      },
      required: ["card_id", "title"],
    },
  },
  {
    name: "kaiten_create_checklist_item",
    description: "Add an item to a checklist",
    inputSchema: {
      type: "object",
      properties: {
        checklist_id: { type: "number", description: "Checklist ID" },
        text: { type: "string", description: "Item text" },
        checked: { type: "boolean", description: "Whether item is checked" },
      },
      required: ["checklist_id", "text"],
    },
  },
  {
    name: "kaiten_update_checklist_item",
    description: "Update a checklist item (text or checked status)",
    inputSchema: {
      type: "object",
      properties: {
        checklist_id: { type: "number", description: "Checklist ID" },
        item_id: { type: "number", description: "Item ID" },
        text: { type: "string" },
        checked: { type: "boolean" },
      },
      required: ["checklist_id", "item_id"],
    },
  },

  // ───── CARD TIME LOGS ─────
  {
    name: "kaiten_list_card_time_logs",
    description: "List time log entries for a card",
    inputSchema: {
      type: "object",
      properties: { card_id: { type: "number", description: "Card ID" } },
      required: ["card_id"],
    },
  },
  {
    name: "kaiten_create_card_time_log",
    description: "Add a time log entry to a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        time: { type: "number", description: "Time spent in minutes" },
        date: { type: "string", description: "Date of work (ISO 8601)" },
        comment: { type: "string", description: "Optional note" },
      },
      required: ["card_id", "time"],
    },
  },
  {
    name: "kaiten_update_card_time_log",
    description: "Update a time log entry",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Time log ID" },
        time: { type: "number", description: "Time in minutes" },
        date: { type: "string" },
        comment: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "kaiten_delete_card_time_log",
    description: "Delete a time log entry",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Time log ID" } },
      required: ["id"],
    },
  },

  // ───── CARD BLOCKERS ─────
  {
    name: "kaiten_list_card_blockers",
    description: "List blockers for a card",
    inputSchema: {
      type: "object",
      properties: { card_id: { type: "number", description: "Card ID" } },
      required: ["card_id"],
    },
  },
  {
    name: "kaiten_create_card_blocker",
    description: "Add a blocker to a card",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "number", description: "Card ID" },
        reason: { type: "string", description: "Reason for blocking" },
        blocker_card_id: { type: "number", description: "Blocking card ID (optional)" },
      },
      required: ["card_id", "reason"],
    },
  },
  {
    name: "kaiten_delete_card_blocker",
    description: "Remove a blocker from a card",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Blocker ID" } },
      required: ["id"],
    },
  },

  // ───── CARD CHILDREN ─────
  {
    name: "kaiten_list_card_children",
    description: "List child cards of a parent card",
    inputSchema: {
      type: "object",
      properties: { card_id: { type: "number", description: "Parent card ID" } },
      required: ["card_id"],
    },
  },

  // ───── DOCUMENTS ─────
  {
    name: "kaiten_list_documents",
    description: "List documents. Optionally filter by space_id.",
    inputSchema: {
      type: "object",
      properties: {
        space_id: { type: "number", description: "Filter by space ID" },
      },
      required: [],
    },
  },
  {
    name: "kaiten_get_document",
    description: "Get a specific document by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Document ID" } },
      required: ["id"],
    },
  },
  {
    name: "kaiten_create_document",
    description:
      "Create a new document in a space. If `content` (markdown) is provided, the body is set via a follow-up update (markdown is converted to Kaiten ProseMirror JSON: headings, paragraphs, tables, lists, blockquotes, code blocks, bold/italic/code/links).",
    inputSchema: {
      type: "object",
      properties: {
        space_id: { type: "number", description: "Space ID" },
        title: { type: "string", description: "Document title" },
        content: { type: "string", description: "Document body in Markdown (converted to ProseMirror automatically)" },
        sort_order: { type: "number", description: "Position (optional, defaults to 1)" },
        group_id: { type: "number", description: "Document group ID (optional)" },
      },
      required: ["space_id", "title"],
    },
  },
  {
    name: "kaiten_update_document",
    description:
      "Update a document's title and/or body. `content` is Markdown and is converted to Kaiten ProseMirror JSON (headings, paragraphs, tables, lists, blockquotes, code blocks, bold/italic/code/links) and written to the `data` field.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Document ID" },
        title: { type: "string", description: "New document title (optional)" },
        content: { type: "string", description: "New document body in Markdown (optional, replaces existing body)" },
      },
      required: ["id"],
    },
  },
  {
    name: "kaiten_delete_document",
    description: "Delete a document",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Document ID" } },
      required: ["id"],
    },
  },

  // ───── DOCUMENT CONVERSATIONS (inline comments / annotations) ─────
  {
    name: "kaiten_list_document_conversations",
    description:
      "List inline comment threads (conversations) on a document. Each conversation is anchored to a text fragment via `block_uid` (matches an `annotation` mark id in the document body) and contains one or more messages. Use to read review comments left on a document.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID/uid" },
        resolved: { type: "boolean", description: "Filter by resolved state (optional; omit for all)" },
        limit: { type: "number", description: "Max threads to return (default 100)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "kaiten_resolve_document_conversation",
    description:
      "Resolve or unresolve a document comment thread (conversation). Use after addressing a review comment to mark it resolved.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID/uid" },
        conversation_id: { type: "string", description: "Conversation uid (from list_document_conversations)" },
        resolved: { type: "boolean", description: "true to resolve (default), false to reopen" },
      },
      required: ["document_id", "conversation_id"],
    },
  },
  {
    name: "kaiten_add_document_conversation_message",
    description: "Add a reply message to an existing document comment thread (conversation).",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID/uid" },
        conversation_id: { type: "string", description: "Conversation uid" },
        text: { type: "string", description: "Message text" },
      },
      required: ["document_id", "conversation_id", "text"],
    },
  },

  // ───── DOCUMENT GROUPS ─────
  {
    name: "kaiten_list_document_groups",
    description: "List document groups in a space",
    inputSchema: {
      type: "object",
      properties: { space_id: { type: "number", description: "Space ID" } },
      required: ["space_id"],
    },
  },
  {
    name: "kaiten_create_document_group",
    description: "Create a document group in a space",
    inputSchema: {
      type: "object",
      properties: {
        space_id: { type: "number", description: "Space ID" },
        title: { type: "string", description: "Group title" },
      },
      required: ["space_id", "title"],
    },
  },

  // ───── USERS ─────
  {
    name: "kaiten_list_users",
    description: "List all users in the company",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kaiten_get_user",
    description: "Get a specific user by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "User ID" } },
      required: ["id"],
    },
  },

  // ───── SPRINTS ─────
  {
    name: "kaiten_list_sprints",
    description: "List sprints for a board",
    inputSchema: {
      type: "object",
      properties: { board_id: { type: "number", description: "Board ID" } },
      required: ["board_id"],
    },
  },
  {
    name: "kaiten_create_sprint",
    description: "Create a sprint on a board",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "Board ID" },
        title: { type: "string", description: "Sprint title" },
        start_date: { type: "string", description: "Start date (ISO 8601)" },
        end_date: { type: "string", description: "End date (ISO 8601)" },
      },
      required: ["board_id", "title"],
    },
  },
  {
    name: "kaiten_update_sprint",
    description: "Update a sprint",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Sprint ID" },
        title: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
      },
      required: ["id"],
    },
  },

  // ───── CUSTOM PROPERTIES ─────
  {
    name: "kaiten_list_custom_properties",
    description: "List custom card properties for a space",
    inputSchema: {
      type: "object",
      properties: { space_id: { type: "number", description: "Space ID" } },
      required: ["space_id"],
    },
  },

  // ───── AUDIT LOG ─────
  {
    name: "kaiten_list_audit_logs",
    description: "List audit log entries (company-level activity)",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: [],
    },
  },
];

async function handleTool(name, args) {
  switch (name) {
    // ── Auth ──
    case "kaiten_get_current_user":
      return kaitenRequest("GET", "/users/current");

    // ── Spaces ──
    case "kaiten_list_spaces":
      return kaitenRequest("GET", "/spaces");
    case "kaiten_get_space":
      return kaitenRequest("GET", `/spaces/${args.id}`);
    case "kaiten_create_space":
      return kaitenRequest("POST", "/spaces", args);
    case "kaiten_update_space": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/spaces/${id}`, body);
    }
    case "kaiten_delete_space":
      return kaitenRequest("DELETE", `/spaces/${args.id}`);

    // ── Space Users ──
    case "kaiten_list_space_users":
      return kaitenRequest("GET", `/space-users?space_id=${args.space_id}`);
    case "kaiten_invite_user_to_space":
      return kaitenRequest("POST", "/space-users", args);

    // ── Boards ──
    case "kaiten_list_boards": {
      const qs = args.space_id ? `?space_id=${args.space_id}` : "";
      return kaitenRequest("GET", `/space-boards${qs}`);
    }
    case "kaiten_get_board":
      return kaitenRequest("GET", `/boards/${args.id}`);
    case "kaiten_create_board":
      return kaitenRequest("POST", "/space-boards", args);
    case "kaiten_update_board": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/space-boards/${id}`, body);
    }
    case "kaiten_delete_board":
      return kaitenRequest("DELETE", `/space-boards/${args.id}`);

    // ── Columns ──
    case "kaiten_list_columns":
      return kaitenRequest("GET", `/columns?board_id=${args.board_id}`);
    case "kaiten_create_column":
      return kaitenRequest("POST", "/columns", args);
    case "kaiten_update_column": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/columns/${id}`, body);
    }
    case "kaiten_delete_column":
      return kaitenRequest("DELETE", `/columns/${args.id}`);

    // ── Lanes ──
    case "kaiten_list_lanes":
      return kaitenRequest("GET", `/lanes?board_id=${args.board_id}`);
    case "kaiten_create_lane":
      return kaitenRequest("POST", "/lanes", args);
    case "kaiten_update_lane": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/lanes/${id}`, body);
    }
    case "kaiten_delete_lane":
      return kaitenRequest("DELETE", `/lanes/${args.id}`);

    // ── Cards ──
    case "kaiten_list_cards": {
      const params = new URLSearchParams();
      if (args.board_id) params.set("board_id", args.board_id);
      if (args.column_id) params.set("column_id", args.column_id);
      if (args.lane_id) params.set("lane_id", args.lane_id);
      if (args.limit) params.set("limit", args.limit);
      if (args.offset) params.set("offset", args.offset);
      const qs = params.toString() ? `?${params}` : "";
      return kaitenRequest("GET", `/cards${qs}`);
    }
    case "kaiten_get_card":
      return kaitenRequest("GET", `/cards/${args.id}`);
    case "kaiten_create_card":
      return kaitenRequest("POST", "/cards", args);
    case "kaiten_update_card": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/cards/${id}`, body);
    }
    case "kaiten_delete_card":
      return kaitenRequest("DELETE", `/cards/${args.id}`);
    case "kaiten_move_card": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/cards/${id}`, body);
    }

    // ── Card Members ──
    case "kaiten_add_card_member":
      return kaitenRequest("POST", "/card-members", args);
    case "kaiten_remove_card_member":
      return kaitenRequest(
        "DELETE",
        `/card-members?card_id=${args.card_id}&user_id=${args.user_id}`
      );

    // ── Card Tags ──
    case "kaiten_add_card_tag":
      return kaitenRequest("POST", "/card-tags", args);
    case "kaiten_remove_card_tag":
      return kaitenRequest(
        "DELETE",
        `/card-tags?card_id=${args.card_id}&tag_id=${args.tag_id}`
      );

    // ── Comments ──
    case "kaiten_list_card_comments":
      return kaitenRequest(
        "GET",
        `/card-comments?card_id=${args.card_id}`
      );
    case "kaiten_create_card_comment":
      return kaitenRequest("POST", "/card-comments", args);
    case "kaiten_update_card_comment": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/card-comments/${id}`, body);
    }
    case "kaiten_delete_card_comment":
      return kaitenRequest("DELETE", `/card-comments/${args.id}`);

    // ── Checklists ──
    case "kaiten_list_card_checklists":
      return kaitenRequest(
        "GET",
        `/card-checklists?card_id=${args.card_id}`
      );
    case "kaiten_create_card_checklist":
      return kaitenRequest("POST", "/card-checklists", args);
    case "kaiten_create_checklist_item": {
      const { checklist_id, ...body } = args;
      return kaitenRequest(
        "POST",
        `/card-checklists/${checklist_id}/items`,
        body
      );
    }
    case "kaiten_update_checklist_item": {
      const { checklist_id, item_id, ...body } = args;
      return kaitenRequest(
        "PATCH",
        `/card-checklists/${checklist_id}/items/${item_id}`,
        body
      );
    }

    // ── Time Logs ──
    case "kaiten_list_card_time_logs":
      return kaitenRequest(
        "GET",
        `/card-time-logs?card_id=${args.card_id}`
      );
    case "kaiten_create_card_time_log":
      return kaitenRequest("POST", "/card-time-logs", args);
    case "kaiten_update_card_time_log": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/card-time-logs/${id}`, body);
    }
    case "kaiten_delete_card_time_log":
      return kaitenRequest("DELETE", `/card-time-logs/${args.id}`);

    // ── Blockers ──
    case "kaiten_list_card_blockers":
      return kaitenRequest(
        "GET",
        `/card-blockers?card_id=${args.card_id}`
      );
    case "kaiten_create_card_blocker":
      return kaitenRequest("POST", "/card-blockers", args);
    case "kaiten_delete_card_blocker":
      return kaitenRequest("DELETE", `/card-blockers/${args.id}`);

    // ── Card Children ──
    case "kaiten_list_card_children":
      return kaitenRequest(
        "GET",
        `/cards?parent_id=${args.card_id}`
      );

    // ── Documents ──
    case "kaiten_list_documents": {
      const qs = args.space_id ? `?space_id=${args.space_id}` : "";
      return kaitenRequest("GET", `/documents${qs}`);
    }
    case "kaiten_get_document":
      return kaitenRequest("GET", `/documents/${args.id}`);
    case "kaiten_create_document": {
      const { content, ...createArgs } = args;
      if (createArgs.sort_order == null) createArgs.sort_order = 1;
      // Create endpoint cannot set body — only title/sort_order/parent. Body is
      // set in a follow-up update with `data` (ProseMirror JSON).
      const doc = await kaitenRequest("POST", "/documents", createArgs);
      if (content && content.trim()) {
        return kaitenRequest("PATCH", `/documents/${doc.id}`, {
          sort_order: doc.sort_order ?? createArgs.sort_order,
          data: markdownToKaitenDoc(content),
        });
      }
      return doc;
    }
    case "kaiten_update_document": {
      const { id, content, ...body } = args;
      if (content != null) body.data = markdownToKaitenDoc(content);
      if (body.sort_order == null) {
        const cur = await kaitenRequest("GET", `/documents/${id}`);
        body.sort_order = cur.sort_order ?? 1;
      }
      return kaitenRequest("PATCH", `/documents/${id}`, body);
    }
    case "kaiten_delete_document":
      return kaitenRequest("DELETE", `/documents/${args.id}`);

    // ── Document Conversations (inline comments) ──
    case "kaiten_list_document_conversations": {
      const params = new URLSearchParams();
      if (args.resolved != null) params.set("resolved", String(args.resolved));
      params.set("limit", String(args.limit ?? 100));
      params.set("offset", String(args.offset ?? 0));
      return kaitenRequest(
        "GET",
        `/documents/${args.document_id}/conversations?${params}`
      );
    }
    case "kaiten_resolve_document_conversation":
      return kaitenRequest(
        "PATCH",
        `/documents/${args.document_id}/conversations/${args.conversation_id}`,
        { resolved: args.resolved ?? true }
      );
    case "kaiten_add_document_conversation_message":
      return kaitenRequest(
        "POST",
        `/documents/${args.document_id}/conversations/${args.conversation_id}/messages`,
        { text: args.text }
      );

    // ── Document Groups ──
    case "kaiten_list_document_groups":
      return kaitenRequest(
        "GET",
        `/document-groups?space_id=${args.space_id}`
      );
    case "kaiten_create_document_group":
      return kaitenRequest("POST", "/document-groups", args);

    // ── Users ──
    case "kaiten_list_users":
      return kaitenRequest("GET", "/users");
    case "kaiten_get_user":
      return kaitenRequest("GET", `/users/${args.id}`);

    // ── Sprints ──
    case "kaiten_list_sprints":
      return kaitenRequest("GET", `/sprints?board_id=${args.board_id}`);
    case "kaiten_create_sprint":
      return kaitenRequest("POST", "/sprints", args);
    case "kaiten_update_sprint": {
      const { id, ...body } = args;
      return kaitenRequest("PATCH", `/sprints/${id}`, body);
    }

    // ── Custom Properties ──
    case "kaiten_list_custom_properties":
      return kaitenRequest(
        "GET",
        `/custom-properties?space_id=${args.space_id}`
      );

    // ── Audit Log ──
    case "kaiten_list_audit_logs": {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", args.limit);
      if (args.offset) params.set("offset", args.offset);
      const qs = params.toString() ? `?${params}` : "";
      return kaitenRequest("GET", `/audit-logs${qs}`);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createServer() {
  const s = new Server(
    { name: "kaiten-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  s.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });
  return s;
}

const httpPort = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : null;

if (httpPort) {
  const { default: express } = await import("express");
  const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");

  const app = express();
  app.use(express.json());

  const sessions = new Map();

  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/message", res);
    const server = createServer();
    sessions.set(transport.sessionId, { transport, server });
    res.on("close", () => sessions.delete(transport.sessionId));
    await server.connect(transport);
  });

  app.post("/message", async (req, res) => {
    const { transport } = sessions.get(req.query.sessionId) ?? {};
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  app.listen(httpPort, () =>
    console.error(`[kaiten-mcp] HTTP/SSE listening on :${httpPort}`)
  );
} else {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
