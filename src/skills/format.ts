/**
 * Parses Markdown body into sections keyed by ## headings.
 * Heading names are normalized to camelCase (e.g., "System Prompt" -> "systemPrompt").
 */
export function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const headingRegex = /^## (.+)$/gm;
  const headings: Array<{ name: string; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({ name: match[1].trim(), index: match.index + match[0].length });
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index;
    const end = i + 1 < headings.length
      ? content.lastIndexOf('##', headings[i + 1].index)
      : content.length;
    const key = toCamelCase(headings[i].name);
    sections[key] = content.slice(start, end).trim();
  }

  return sections;
}

function toCamelCase(heading: string): string {
  const words = heading.split(/\s+/);
  return words
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}
