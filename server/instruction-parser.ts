const COMMAND_RE = /(?:update|replace)\s+(\w+)\s+with\s*:/gi;

export function parseInstructions(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  const commandPositions: { blockName: string; contentStart: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = COMMAND_RE.exec(text)) !== null) {
    commandPositions.push({
      blockName: match[1].toUpperCase(),
      contentStart: match.index + match[0].length,
    });
  }

  for (let i = 0; i < commandPositions.length; i++) {
    const start = commandPositions[i].contentStart;
    const end = i + 1 < commandPositions.length
      ? findCommandLineStart(text, commandPositions[i + 1].contentStart, commandPositions[i + 1].blockName)
      : text.length;

    const content = text.slice(start, end).trim();
    if (content) {
      result[commandPositions[i].blockName] = content;
    }
  }

  return result;
}

function findCommandLineStart(text: string, contentStartOfNext: number, _blockName: string): number {
  const searchRe = /(?:update|replace)\s+\w+\s+with\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = searchRe.exec(text)) !== null) {
    if (m.index + m[0].length === contentStartOfNext) {
      const lineStart = text.lastIndexOf("\n", m.index);
      return lineStart >= 0 ? lineStart : m.index;
    }
  }
  return contentStartOfNext;
}
