FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts ./scripts
COPY apps/dashboard ./apps/dashboard
RUN pnpm install --filter @flight-data-collector/dashboard --frozen-lockfile=false

FROM deps AS build
RUN pnpm --filter @flight-data-collector/dashboard build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@flight-data-collector/dashboard", "start"]
