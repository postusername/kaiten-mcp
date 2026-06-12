/**
 * Insert an inline `annotation` mark anchored to the first occurrence of
 * `anchorText` in the ProseMirror doc (splitting the text node if needed).
 * Skips nodes that already carry an annotation. Returns true if anchored.
 */
export function addAnnotation(pm, anchorText, annId) {
  function walk(n) {
    const content = n.content;
    if (!content) return false;
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (
        c.type === "text" &&
        c.text.includes(anchorText) &&
        !(c.marks || []).some((m) => m.type === "annotation")
      ) {
        const start = c.text.indexOf(anchorText);
        const baseMarks = c.marks || [];
        const part = (text, marks) =>
          marks.length ? { type: "text", text, marks } : { type: "text", text };
        const parts = [];
        if (start > 0) parts.push(part(c.text.slice(0, start), baseMarks));
        parts.push(
          part(anchorText, [
            ...baseMarks,
            { type: "annotation", attrs: { id: annId, resolved: false } },
          ])
        );
        const rest = c.text.slice(start + anchorText.length);
        if (rest) parts.push(part(rest, baseMarks));
        content.splice(i, 1, ...parts);
        return true;
      }
      if (walk(c)) return true;
    }
    return false;
  }
  return walk(pm);
}

/** Copy inline `annotation` marks from old ProseMirror doc onto new doc (match by exact text). */
export function restoreAnnotations(oldPm, newPm) {
  const annByText = new Map();

  function collect(n) {
    if (n.type === "text" && n.marks) {
      for (const m of n.marks) {
        if (m.type === "annotation") annByText.set(n.text, m);
      }
    }
    for (const c of n.content || []) collect(c);
  }
  collect(oldPm);

  let restored = 0;
  function apply(n) {
    if (n.type === "text" && annByText.has(n.text)) {
      const ann = annByText.get(n.text);
      n.marks = n.marks || [];
      if (!n.marks.some((m) => m.type === "annotation")) {
        n.marks.push(JSON.parse(JSON.stringify(ann)));
        restored++;
      }
    }
    for (const c of n.content || []) apply(c);
  }
  apply(newPm);

  return restored;
}
