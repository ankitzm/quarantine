'use client';

import type {
  ApplyResponse,
  ErrorResponse,
  IncidentResponse,
  MemoryResponse,
  PlanResponse,
  ReachResponse,
  TimelineResponse,
  TraceStreamEvent,
} from '@quarantine/graph/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as T | ErrorResponse | null;
  if (!res.ok || !body) {
    const err = (body as ErrorResponse | null)?.error;
    throw new ApiError(err?.code ?? 'NETWORK', err?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface ConsoleData {
  incident: IncidentResponse;
  timeline: TimelineResponse;
  memory: MemoryResponse;
  reach: ReachResponse;
  plan: PlanResponse;
}

type State =
  { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; data: ConsoleData };

const ROUND_MS = 420;

/**
 * Everything the console shows for one incident, from the visitor's own demo graph. The plan is
 * created on load (deterministic, so this is safe to repeat) and applying it refreshes the rest.
 */
export function useConsole(seed: string) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [round, setRound] = useState(Infinity);
  const [roundOf, setRoundOf] = useState<Map<string, number>>(new Map());
  const timers = useRef<number[]>([]);

  const load = useCallback(async () => {
    const s = encodeURIComponent(seed);
    try {
      const [incident, timeline, memory, reach, plan] = await Promise.all([
        api<IncidentResponse>(`/api/incidents/${s}`),
        api<TimelineResponse>(`/api/incidents/${s}/timeline`),
        api<MemoryResponse>('/api/memory'),
        api<ReachResponse>(`/api/incidents/${s}/reach`),
        // Once contained, the server returns the plan that was applied.
        api<PlanResponse>(`/api/incidents/${s}/plans`, { method: 'POST' }),
      ]);
      setState({ status: 'ready', data: { incident, timeline, memory, reach, plan } });
    } catch (e) {
      setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError('NETWORK', String(e)) });
    }
  }, [seed]);

  /** Streams the trace and reveals it one relaxation round at a time. */
  const replay = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const source = new EventSource(`/api/incidents/${encodeURIComponent(seed)}/stream`);
    const rounds = new Map<string, number>();
    let last = 0;
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data as string) as TraceStreamEvent;
      if (event.type === 'round') {
        for (const n of [...event.episodes, ...event.items])
          if (!rounds.has(n.id)) rounds.set(n.id, event.round);
        last = event.round;
        return;
      }
      source.close();
      setRoundOf(new Map(rounds));
      if (reduce) return setRound(Infinity);
      setRound(0);
      for (let r = 1; r <= last; r++) timers.current.push(window.setTimeout(() => setRound(r), r * ROUND_MS));
      timers.current.push(window.setTimeout(() => setRound(Infinity), (last + 1) * ROUND_MS));
    };
    source.onerror = () => {
      source.close();
      setRound(Infinity);
    };
  }, [seed]);

  useEffect(() => {
    void load().then(replay);
    return () => {
      for (const t of timers.current) window.clearTimeout(t);
    };
  }, [load, replay]);

  const apply = useCallback(
    async (planId: string) => {
      const result = await api<ApplyResponse>(`/api/plans/${encodeURIComponent(planId)}/apply`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      await load();
      return result;
    },
    [load],
  );

  const reset = useCallback(async () => {
    setState({ status: 'loading' });
    await api('/api/demo/reset', { method: 'POST' });
    await load();
    replay();
  }, [load, replay]);

  return { state, round, roundOf, replay, apply, reset, retry: load };
}
