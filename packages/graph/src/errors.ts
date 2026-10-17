/** Typed failures that cross the API boundary. `code` is stable and safe to show to clients. */
export class QuarantineError extends Error {
  constructor(
    readonly code: 'GRAPH_NOT_READY' | 'QUERY_TIMEOUT' | 'PLAN_NOT_FOUND' | 'CONFIRM_REQUIRED',
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class GraphNotReady extends QuarantineError {
  constructor(graph: string) {
    super('GRAPH_NOT_READY', 503, `graph "${graph}" is not loaded yet`);
  }
}

export class QueryTimeout extends QuarantineError {
  constructor(query: string, timeoutMs: number) {
    super('QUERY_TIMEOUT', 504, `query "${query}" exceeded ${timeoutMs}ms`);
  }
}

export class PlanNotFound extends QuarantineError {
  constructor(planId: string) {
    super('PLAN_NOT_FOUND', 404, `plan "${planId}" does not exist`);
  }
}

export class ConfirmRequired extends QuarantineError {
  constructor() {
    super('CONFIRM_REQUIRED', 400, 'applying a quarantine requires confirm=true');
  }
}
