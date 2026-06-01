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
