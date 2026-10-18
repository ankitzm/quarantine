/**
 * Turns free text into a safe full-text query: letters and digits only, space-joined (all terms must
 * match). Punctuation is query syntax in FalkorDB's full-text engine, so passing user or agent text
 * through unchanged turns `") OR 1=1` into a syntax error. Returns null when nothing searchable is left.
 */
export function fullTextQuery(text: string): string | null {
  const terms = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 10) ?? [];
  return terms.length ? terms.join(' ') : null;
}
