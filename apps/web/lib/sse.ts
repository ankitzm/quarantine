/**
 * A Server-Sent Events response. `start` gets a `send` for `data:` payloads and may return (or resolve to)
 * a cleanup function, run when the client disconnects or `close` is called.
 */
export function sse(
  req: Request,
  start: (send: (data: unknown) => void, close: () => void) => unknown,
): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup?.();
        controller.close();
      };
      const send = (data: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      req.signal.addEventListener('abort', close);
      const result = await start(send, close);
      if (typeof result === 'function') cleanup = result as () => void;
      if (closed) cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
