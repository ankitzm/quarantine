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
    void fetch('/api/queries?limit=40')
      .then((r) => (r.ok ? (r.json() as Promise<QueryLogResponse>) : null))
      .then((log) => log && setEntries((prev) => [...prev, ...log.entries.toReversed()].slice(0, KEEP)));
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
        Every statement run against your copy of the graph, newest first. New ones appear as they run.
      </p>
      {entries.length === 0 ? (
        <p className={s.sheetEmpty}>No queries yet. Reset the demo or apply the plan to see some run.</p>
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
