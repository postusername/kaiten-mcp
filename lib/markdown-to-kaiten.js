// Markdown → Kaiten ProseMirror JSON (see index.js tool docs for schema notes)

function mdUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

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
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur);
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur);
  return cells;
}

const MD_TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

export function markdownToKaitenDoc(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const content = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      const language = fence[1].trim() || null;
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      content.push({
        type: "code_block",
        attrs: { language, lineNumbers: false },
        content: buf.length ? [{ type: "text", text: buf.join("\n") }] : [],
      });
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      content.push({ type: "horizontal_rule" });
      i++;
      continue;
    }

    const img = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      content.push({
        type: "image",
        attrs: { id: mdUuid(), src: img[2], alt: img[1] || null, title: null },
      });
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const type = level <= 2 ? "heading2" : "heading3";
      const text = h[2].trim();
      content.push({
        type,
        attrs: { textAlign: "left", id: mdSlug(text) },
        content: mdParseInline(text),
      });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1])) {
      const header = mdSplitRow(line);
      i += 2;
      const rows = [{ type: "table_row", content: header.map((c) => mdTableCell(c, true)) }];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const cells = mdSplitRow(lines[i]);
        rows.push({ type: "table_row", content: cells.map((c) => mdTableCell(c, false)) });
        i++;
      }
      content.push({ type: "table", attrs: { size: "fixed" }, content: rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      content.push({ type: "blockquote", content: [mdParagraph(buf.join(" ").trim())] });
      continue;
    }

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
      !/^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && MD_TABLE_SEP.test(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    content.push(mdParagraph(buf.join(" ")));
  }

  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph", attrs: { textAlign: "left" } }],
  };
}
