# Architecture

Flight Data Collector is a pnpm TypeScript monorepo.

- `apps/dashboard`: Next.js operational dashboard.
- `apps/api`: Fastify API with basic auth.
- `apps/collector`: BullMQ worker for live polling, historical job placeholders, heartbeat and alert evaluation.
- `packages/db`: Prisma schema and database access.
- `packages/providers`: provider adapter interface and implemented provider adapters.
- `packages/core`: shared domain and geo helpers.
- `packages/analytics`: reserved for metric/data-cube helpers.

The local v1 deployment uses Docker Compose with PostgreSQL/PostGIS, Redis, API, collector and dashboard services.
