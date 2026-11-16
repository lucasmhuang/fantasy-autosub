# The web app, built from the whole workspace. Node is pinned to the version development uses.
FROM node:24.14.0-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@10.33.0

WORKDIR /app

# Dependencies first, keyed on the lockfile alone, so a code-only change reuses this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
# --ignore-scripts also skips the root's `prepare` (lefthook install), which needs git. The full
# install keeps drizzle-kit, which the host's pre-deploy command (pnpm db:migrate) runs.
RUN pnpm install --offline --frozen-lockfile --ignore-scripts
RUN pnpm build

ENV NODE_ENV=production
# Next writes its cache under .next while it runs.
RUN chown -R node:node apps/web/.next
USER node

# next start reads PORT. Started without the pnpm wrapper, which would add about 96 MiB. It runs
# from apps/web: Next loads next.config.ts's own relative imports (./lib/image-config) from the
# working directory, so `next start apps/web` from /app can't find them. exec keeps node as the
# process that gets SIGTERM. The worker and the pre-deploy command keep /app (their own commands).
CMD ["sh", "-c", "cd apps/web && exec node node_modules/next/dist/bin/next start"]
