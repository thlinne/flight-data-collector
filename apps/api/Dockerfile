FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --filter @flight-data-collector/api... --frozen-lockfile=false
RUN pnpm --filter @flight-data-collector/db db:generate

FROM deps AS build
RUN pnpm --filter @flight-data-collector/api... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["pnpm", "--filter", "@flight-data-collector/api", "start"]
