#!/usr/bin/env node
/**
 * PATCH Kaiten document body from markdown, preserving sort_order and inline annotations.
 *
 * Usage:
 *   KAITEN_TOKEN=... KAITEN_DOMAIN=... node scripts/update-document-from-markdown.mjs <doc-uuid> <file.md>
 *
 * WARNING: replaces the entire document body. Do NOT smoke-test on production docs.
 */
import { readFileSync } from "fs";
import { markdownToKaitenDoc } from "../lib/markdown-to-kaiten.js";
import { restoreAnnotations } from "../lib/restore-annotations.js";

const KAITEN_TOKEN = process.env.KAITEN_TOKEN;
const KAITEN_DOMAIN = process.env.KAITEN_DOMAIN;

if (!KAITEN_TOKEN || !KAITEN_DOMAIN) {
  console.error("Set KAITEN_TOKEN and KAITEN_DOMAIN");
  process.exit(1);
}

const [docId, mdPath] = process.argv.slice(2);
if (!docId || !mdPath) {
  console.error("Usage: node scripts/update-document-from-markdown.mjs <doc-uuid> <file.md>");
  process.exit(1);
}

const BASE = `https://${KAITEN_DOMAIN}.kaiten.ru/api/v1`;
const headers = {
  Authorization: `Bearer ${KAITEN_TOKEN}`,
  "Content-Type": "application/json",
};

const cur = await fetch(`${BASE}/documents/${docId}`, { headers }).then((r) => {
  if (!r.ok) throw new Error(`GET ${r.status}: ${r.statusText}`);
  return r.json();
});

const oldPm = JSON.parse(cur.data);
const md = readFileSync(mdPath, "utf8");
const newPm = markdownToKaitenDoc(md);
const restored = restoreAnnotations(oldPm, newPm);

const res = await fetch(`${BASE}/documents/${docId}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ data: newPm, sort_order: cur.sort_order ?? 1 }),
});

if (!res.ok) throw new Error(`PATCH ${res.status}: ${await res.text()}`);

const out = await res.json();
console.log(JSON.stringify({ title: out.title, updated: out.updated, annotations_restored: restored }, null, 2));
