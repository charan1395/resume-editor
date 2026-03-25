import { diffWordsWithSpace } from "diff";

export function generateDiffHtml(before: string, after: string): string {
  const changes = diffWordsWithSpace(before, after);
  let html = "";

  for (const part of changes) {
    const escaped = escapeHtml(part.value);
    if (part.added) {
      html += `<ins>${escaped}</ins>`;
    } else if (part.removed) {
      html += `<del>${escaped}</del>`;
    } else {
      html += escaped;
    }
  }

  return `<pre style="white-space: pre-wrap; word-break: break-word;">${html}</pre>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
