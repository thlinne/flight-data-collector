# Docker Deployment

For local Windows 11 operation:

```bash
docker compose -f infra/docker-compose.yml up --build
```

Before using real APIs, copy `.env.example` to `.env`, change `ADMIN_PASSWORD`, and set provider API keys. API keys remain server-side and are never exposed in the dashboard.

GitHub Actions is CI only and must not be used for 24/7 collection.
