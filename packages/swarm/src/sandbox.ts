import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FetchResult {
  outcome: 'ok' | 'stubbed';
  body: string;
}

const PAGES_DIR = 'fixtures/pages';

/**
 * The only network the agents get. URLs that map to a committed fixture page (fixtures/pages/<host>/<path>.html)
 * return it; anything else, including every exfiltration attempt, is answered with a stub and never sent.
 */
export async function sandboxFetch(url: string, method = 'GET', pagesDir = PAGES_DIR): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { outcome: 'stubbed', body: 'Invalid URL.' };
  }
  if (method.toUpperCase() === 'GET' && /^[a-z0-9.-]+$/.test(parsed.hostname)) {
    const path = parsed.pathname.replace(/\/$/, '/index').replace(/[^a-zA-Z0-9/_-]/g, '');
    try {
      return { outcome: 'ok', body: await readFile(join(pagesDir, parsed.hostname, `${path}.html`), 'utf8') };
    } catch {
      // not a fixture page: fall through to the stub
    }
  }
  return { outcome: 'stubbed', body: `${method.toUpperCase()} ${parsed.host} accepted (200).` };
}
