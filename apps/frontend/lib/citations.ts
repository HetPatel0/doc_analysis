import type { Citation } from "@/lib/workspace-types";

const SOURCE_TOKEN = /^(?:p\.\s*\d+|chunk\s*\d+|document)$/i;

export function citationsFromSources(sources: string[]): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const label = source?.trim();
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);

    const pageMatch = label.match(/p\.\s*(\d+)/i);
    const chunkMatch = label.match(/chunk\s*(\d+)/i);
    citations.push({
      label,
      page: pageMatch ? Number.parseInt(pageMatch[1], 10) : null,
      chunk: chunkMatch ? Number.parseInt(chunkMatch[1], 10) : null,
    });
  }

  return citations;
}

/**
 * The backend appends a plain "Sources: p. 3, chunk 2" footer when the model
 * did not cite inline. Split it out so the UI can render clickable chips.
 */
export function splitSourceFooter(content: string): {
  body: string;
  citations: Citation[];
} {
  const match = content.match(/\n{2,}Sources:\s*([^\n]+)\s*$/i);
  if (!match) {
    return { body: content, citations: [] };
  }

  const tokens = match[1]
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0 || tokens.some((token) => !SOURCE_TOKEN.test(token))) {
    return { body: content, citations: [] };
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.toLowerCase().startsWith("p.")) {
      const page = Number.parseInt(token.replace(/\D/g, ""), 10);
      const key = `p.${page}`;
      if (!seen.has(key)) {
        seen.add(key);
        citations.push({ label: token, page });
      }
    } else if (token.toLowerCase().startsWith("chunk") && citations.length > 0) {
      const previous = citations[citations.length - 1];
      previous.label = `${previous.label}, ${token}`;
      previous.chunk = Number.parseInt(token.replace(/\D/g, ""), 10);
    } else if (!seen.has(token)) {
      seen.add(token);
      citations.push({ label: token, page: null });
    }
  }

  return {
    body: content.slice(0, match.index).replace(/\s+$/, ""),
    citations,
  };
}
