FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/db ./packages/db
RUN pnpm install --filter @flight-data-collector/db --frozen-lockfile=false

CMD ["sh", "-c", "pnpm exec prisma db push --schema packages/db/prisma/schema.prisma && pnpm --filter @flight-data-collector/db db:seed"]
