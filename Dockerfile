FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Load any tenant graph that is not ready yet (REPLAY_FORCE=1 rebuilds them all, e.g. after fixtures
# change), then serve. One long-lived process keeps the query log ring buffer and SSE subscribers coherent.
CMD ["sh", "-c", "pnpm replay $([ \"$REPLAY_FORCE\" = 1 ] || echo --if-missing) && pnpm --filter web exec next start -H 0.0.0.0 -p ${PORT}"]
