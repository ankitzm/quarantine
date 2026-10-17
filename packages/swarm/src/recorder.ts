import { applyEvents, FalkorDBStore, stableId, type EventInput } from '@quarantine/graph';

export interface TranscriptEntry {
  t: number;
  agent: string;
  kind: 'user' | 'tool' | 'handoff' | 'decision' | 'message';
  content: string;
}

interface Episode {
  id: string;
  agent: string;
  inputs: string[];
}

/**
 * Turns a live swarm run into the event log. It tracks which episode is active (one per agent turn, a new
 * one on every handoff), applies every event to the graph as it happens, and keeps the ordered log and a
 * transcript for the run file. Ids are derived from the run id and counters, so a run file replays to
 * the same graph.
 */
export class Recorder {
  readonly events: EventInput[] = [];
  readonly transcript: TranscriptEntry[] = [];
  readonly store: FalkorDBStore;
  private current: Episode | null = null;
  private seq = 0;

  constructor(
    readonly graph: string,
    readonly tenant: string,
    readonly runId: string,
    readonly now: () => number = Date.now,
  ) {
    this.store = new FalkorDBStore(graph, { now, onEvent: (e) => this.events.push(e) });
  }

  private id(prefix: string): string {
    return stableId(prefix, this.runId, ++this.seq);
  }

  private async emit(...events: EventInput[]): Promise<void> {
    await applyEvents(this.graph, events);
    this.events.push(...events);
  }

  private note(agent: string, kind: TranscriptEntry['kind'], content: string): void {
    this.transcript.push({ t: this.now(), agent, kind, content });
  }

  /** The active episode, which must belong to `agent`: tools may only act for the agent that owns them. */
  episode(agent: string): Episode {
    if (this.current?.agent !== agent) {
      throw new Error(`recorder: ${agent} acted while ${this.current?.agent ?? 'nobody'} was active`);
    }
    return this.current;
  }

  /** Store scoped to the active episode: puts are WROTE (derived from its inputs), reads are READ. */
  storeFor(agent: string): FalkorDBStore {
    const { id, inputs } = this.episode(agent);
    return this.store.as({ episodeId: id, inputIds: [...inputs] });
  }

  async startSession(label: string, agent: string, userText: string): Promise<void> {
    const t = this.now();
    const session = this.runId;
    this.current = { id: this.id('ep'), agent, inputs: [] };
    await this.emit(
      { type: 'Session', id: session, t, tenant: this.tenant, label },
      { type: 'Episode', id: this.current.id, t, session, agent },
    );
    await this.input(agent, 'user', userText);
  }

  async input(agent: string, source: 'user' | 'web' | 'tool', text: string, uri?: string): Promise<void> {
    const episode = this.episode(agent);
    const id = this.id('in');
    episode.inputs.push(id);
    await this.emit({
      type: 'Input',
      id,
      t: this.now(),
      episode: episode.id,
      source,
      text,
      ...(uri ? { uri } : {}),
    });
    this.note(agent, source === 'user' ? 'user' : 'tool', text);
  }

  async handoff(from: string, to: string, summary: string): Promise<void> {
    const prev = this.episode(from);
    const t = this.now();
    this.current = { id: this.id('ep'), agent: to, inputs: [] };
    await this.emit(
      { type: 'Episode', id: this.current.id, t, session: this.runId, agent: to },
      { type: 'Handoff', t, from: prev.id, to: this.current.id, summary },
    );
    this.note(from, 'handoff', `-> ${to}: ${summary}`);
  }

  async toolCall(
    agent: string,
    tool: string,
    args: unknown,
    outcome: 'ok' | 'stubbed' | 'denied',
  ): Promise<void> {
    const episode = this.episode(agent);
    const json = JSON.stringify(args);
    await this.emit({
      type: 'ToolCall',
      id: this.id('call'),
      t: this.now(),
      episode: episode.id,
      tool,
      args: json,
      outcome,
    });
    this.note(agent, 'tool', `${tool} ${json} -> ${outcome}`);
  }

  async decision(agent: string, text: string, basedOn: string[]): Promise<void> {
    const episode = this.episode(agent);
    await this.emit({
      type: 'Decision',
      id: this.id('dec'),
      t: this.now(),
      episode: episode.id,
      text,
      basedOn,
    });
    this.note(agent, 'decision', text);
  }

  message(agent: string, content: string): void {
    if (content.trim()) this.note(agent, 'message', content);
  }
}
