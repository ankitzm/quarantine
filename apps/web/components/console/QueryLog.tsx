'use client';

import type { QueryLogResponse } from '@quarantine/graph/types';
import { useEffect, useRef, useState } from 'react';
import s from './console.module.css';

type Entry = QueryLogResponse['entries'][number];
const KEEP = 80;

/** Live tail of the Cypher this visitor's graph is running, newest first. */
export function QueryLog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const source = new EventSource('/api/queries/stream');
    source.onmessage = (msg) => {
      const entry = JSON.parse(msg.data as string) as Entry;
      setEntries((prev) => [entry, ...prev].slice(0, KEEP));
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      source.close();
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <aside ref={panel} className={s.sheet} aria-labelledby="queries-title" tabIndex={-1}>
      <div className={s.sheetHead}>
        <h2 id="queries-title" className={s.h2}>
          Queries
        </h2>
        <button type="button" className={s.quiet} onClick={onClose}>
          Close
        </button>
      </div>
      <p className={s.sheetNote}>
        Every statement your session runs, as it runs. Click around the console to see them.
      </p>
      {entries.length === 0 ? (
        <p className={s.sheetEmpty}>Waiting for the next query…</p>
      ) : (
        <ol className={s.queryList} aria-live="polite">
          {entries.map((e) => (
            <li key={e.seq}>
              <details>
                <summary>
                  <span className={`${s.qMode} mono`}>{e.mode === 'read' ? 'read' : 'write'}</span>
                  <span className={`${s.qName} mono`}>{e.name}</span>
                  <span className={`${s.qStat} mono`}>
                    {e.ms} ms · {e.rows} rows
                  </span>
                </summary>
                <pre className={s.cypher}>{e.error ?? e.cypher}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
