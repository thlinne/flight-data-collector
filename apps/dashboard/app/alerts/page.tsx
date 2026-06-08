import { revalidatePath } from "next/cache";
import { apiGet, apiPatch } from "../api";

async function acknowledge(formData: FormData) {
  "use server";
  await apiPatch(`/alerts/${String(formData.get("id"))}/acknowledge`, {});
  revalidatePath("/alerts");
}

async function resolveAlert(formData: FormData) {
  "use server";
  await apiPatch(`/alerts/${String(formData.get("id"))}/resolve`, {});
  revalidatePath("/alerts");
}

export default async function AlertsPage() {
  const alerts = await apiGet<Array<{ id: string; severity: string; status: string; message: string; triggeredAt: string; provider?: { id: string; name: string } | null; country?: { id: string; name: string } | null; windowStart: string; windowEnd: string; alertRule: { alertType: string } }>>("/alerts", []);
  const openCritical = alerts.filter((alert) => alert.status === "OPEN" && alert.severity === "CRITICAL");
  const openWarnings = alerts.filter((alert) => alert.status === "OPEN" && alert.severity === "WARNING");
  return (
    <>
      <h1 className="page-title">System Alerts</h1>
      <section className="grid">
        <div className="card metric">Open critical alerts<strong>{openCritical.length}</strong></div>
        <div className="card metric">Open warnings<strong>{openWarnings.length}</strong></div>
        <div className="card metric">No-data alerts<strong>{alerts.filter((alert) => alert.alertRule.alertType === "PROVIDER_NO_DATA").length}</strong></div>
        <div className="card metric">Low-volume alerts<strong>{alerts.filter((alert) => alert.alertRule.alertType === "PROVIDER_LOW_VOLUME").length}</strong></div>
        <div className="card metric">Error-rate alerts<strong>{alerts.filter((alert) => alert.alertRule.alertType === "PROVIDER_ERROR_RATE_HIGH").length}</strong></div>
      </section>
      <h2>Alert history</h2>
      <table className="table">
        <thead><tr><th>Status</th><th>Severity</th><th>Type</th><th>Message</th><th>Related</th><th>Actions</th></tr></thead>
        <tbody>{alerts.map((alert) => <tr key={alert.id}><td className={alert.status === "OPEN" ? "status-open" : ""}>{alert.status}</td><td className={alert.severity === "WARNING" ? "status-warning" : ""}>{alert.severity}</td><td>{alert.alertRule.alertType}</td><td>{alert.message}</td><td>{alert.provider?.name ?? null} {alert.country?.name ?? null} <a href="/raw">Raw window</a></td><td><form action={acknowledge}><input type="hidden" name="id" value={alert.id} /><button className="button secondary">Acknowledge</button></form><form action={resolveAlert}><input type="hidden" name="id" value={alert.id} /><button className="button">Resolve</button></form></td></tr>)}</tbody>
      </table>
    </>
  );
}
