# Flight Data Collector

Standalone internal data acquisition and analytics platform for evaluating flight data providers. It is not the ANSP billing app.

## Local Windows 11 Runtime

The v1 runtime target is a Windows 11 PC running Docker Compose continuously.

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Docker:

```bash
docker compose -f infra/docker-compose.yml up --build
```

Services:
- Dashboard: http://localhost:3000
- API: http://localhost:4000
- PostgreSQL/PostGIS: localhost:5432
- Redis: localhost:6379

Default dashboard/API basic auth is controlled by `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

## Current Implementation

- Prisma schema for providers, countries, collection areas, provider-country config, raw responses, normalized observations, alert rules/events and collector heartbeat.
- Mock provider generates live and historical observations.
- Official provider adapters are skeletons for FR24, Plane Finder, AirNav RadarBox and FlightAware.
- Fastify API exposes overview, control, alerts, raw explorer, health and job queue endpoints.
- Collector reloads provider-country config periodically, writes heartbeats, schedules BullMQ jobs, stores successful and failed fetch runs, and evaluates alerts.
- Next.js dashboard includes the requested v1 pages.
- GitHub Actions is CI only.
