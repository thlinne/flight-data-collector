import { revalidatePath } from "next/cache";
import { apiGet, apiPatch, apiPost } from "../api";

async function reviewFailedRuns() {
  "use server";
  await apiPatch("/system-health/failed-runs/review", {});
  revalidatePath("/health");
}

async function rebuildDetectedFlights() {
  "use server";
  await apiPost("/system-health/rebuild-detected-flights", {});
  revalidatePath("/health");
}

export default async function HealthPage() {
  const health = await apiGet<{ heartbeats: Array<{ id: string; serviceName: string; hostname: string; startedAt: string; lastSeenAt: string; status: string; version: string | null }>; failedJobs: Array<{ id: string; startedAt: string; provider: { name: string }; country?: { name: string } | null; errorMessage: string | null }>; database: string; redis: string; queue: string }>("/system-health", { heartbeats: [], failedJobs: [], database: "unknown", redis: "unknown", queue: "unknown" });
  return (
    <>
      <h1 className="page-title">System Health</h1>
      <section className="grid">
        <div className="card metric">Database<strong>{health.database}</strong></div>
        <div className="card metric">Redis<strong>{health.redis}</strong></div>
        <div className="card metric">Queue<strong>{health.queue}</strong></div>
      </section>
      <h2>Database backup</h2>
      <div className="toolbar">
        <a className="button" href="/health/database-backup.sql">Download database backup</a>
      </div>
      <h2>Flight aggregation</h2>
      <form className="toolbar" action={rebuildDetectedFlights}>
        <button className="button secondary">Rebuild flight aggregation</button>
      </form>
      <h2>Collector heartbeat</h2>
      <table className="table">
        <thead><tr><th>Service</th><th>Status</th><th>Last seen</th><th>Started</th><th>Version</th></tr></thead>
        <tbody>{health.heartbeats.map((heartbeat) => <tr key={heartbeat.id}><td>{heartbeat.serviceName}</td><td>{heartbeat.status}</td><td>{heartbeat.lastSeenAt}</td><td>{heartbeat.startedAt}</td><td>{heartbeat.version ?? "n/a"}</td></tr>)}</tbody>
      </table>
      <h2>Failed jobs</h2>
      <form className="toolbar" action={reviewFailedRuns}>
        <button className="button secondary">Mark failed jobs reviewed</button>
      </form>
      <table className="table">
        <thead><tr><th>Started</th><th>Provider</th><th>Country</th><th>Error</th></tr></thead>
        <tbody>{health.failedJobs.map((job) => <tr key={job.id}><td>{job.startedAt}</td><td>{job.provider.name}</td><td>{job.country?.name ?? "n/a"}</td><td>{job.errorMessage}</td></tr>)}</tbody>
      </table>
    </>
  );
}
