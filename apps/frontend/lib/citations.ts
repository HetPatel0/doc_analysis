import type { Citation } from "@/lib/workspace-types";

const SOURCE_LABEL = /p\.\s*\d+(?:\s*,\s*chunk\s*\d+)?|chunk\s*\d+|document/gi;

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
 *
 * Source labels themselves contain commas ("p. 3, chunk 2"), so parse with the
 * label grammar instead of splitting on commas; that also keeps text-only
 * labels ("chunk 2") clickable.
 */
export function splitSourceFooter(content: string): {
  body: string;
  citations: Citation[];
} {
  const match = content.match(/\n{2,}Sources:\s*([^\n]+)\s*$/i);
  if (!match) {
    return { body: content, citations: [] };
  }

  const footer = match[1].trim();
  const leftovers = footer.replace(SOURCE_LABEL, "").replace(/[\s,]+/g, "");
  if (leftovers) {
    return { body: content, citations: [] };
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const token of footer.match(SOURCE_LABEL) ?? []) {
    const label = token.trim();
    const key = label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const pageMatch = label.match(/p\.\s*(\d+)/i);
    const chunkMatch = label.match(/chunk\s*(\d+)/i);

    citations.push({
      label,
      page: pageMatch ? Number.parseInt(pageMatch[1], 10) : null,
      chunk: chunkMatch ? Number.parseInt(chunkMatch[1], 10) : null,
    });
  }

  return {
    body: content.slice(0, match.index).replace(/\s+$/, ""),
    citations,
  };
}
