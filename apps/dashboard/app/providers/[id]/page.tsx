import { apiGet } from "../../api";

export default async function ProviderDetailPage({ params }: { params: { id: string } }) {
  const data = await apiGet<{
    provider: { name: string; providerCountryConfigs: Array<{ id: string; enabled: boolean; maxRequestsPerDay: number | null; maxCreditsPerDay: number | null; country: { name: string } }> } | null;
    runs: number;
    failedRuns: number;
    successRate: number | null;
    usage: {
      requestsToday: number;
      successfulToday: number;
      failedToday: number;
      recordsToday: number;
      requestsThisMonth: number;
      successfulThisMonth: number;
      failedThisMonth: number;
      recordsThisMonth: number;
      bytesThisMonth: number;
    };
    lastErrors: Array<{ id: string; startedAt: string; errorMessage: string | null }>;
  }>(`/provider/${params.id}`, { provider: null, runs: 0, failedRuns: 0, successRate: null, usage: { requestsToday: 0, successfulToday: 0, failedToday: 0, recordsToday: 0, requestsThisMonth: 0, successfulThisMonth: 0, failedThisMonth: 0, recordsThisMonth: 0, bytesThisMonth: 0 }, lastErrors: [] });
  const megabytesThisMonth = (data.usage.bytesThisMonth / 1024 / 1024).toFixed(2);
  return (
    <>
      <h1 className="page-title">{data.provider?.name ?? "Provider Dashboard"}</h1>
      <section className="grid">
        <div className="card metric">Fetch runs<strong>{data.runs}</strong></div>
        <div className="card metric">Failed runs<strong>{data.failedRuns}</strong></div>
        <div className="card metric">Success rate<strong>{data.successRate == null ? "n/a" : `${Math.round(data.successRate * 100)}%`}</strong></div>
      </section>
      <h2>Usage</h2>
      <section className="grid">
        <div className="card metric">Requests today<strong>{data.usage.requestsToday}</strong></div>
        <div className="card metric">Successful today<strong>{data.usage.successfulToday}</strong></div>
        <div className="card metric">Failed today<strong>{data.usage.failedToday}</strong></div>
        <div className="card metric">Records today<strong>{data.usage.recordsToday}</strong></div>
        <div className="card metric">Requests this month<strong>{data.usage.requestsThisMonth}</strong></div>
        <div className="card metric">Records this month<strong>{data.usage.recordsThisMonth}</strong></div>
        <div className="card metric">Bandwidth this month<strong>{megabytesThisMonth} MB</strong></div>
      </section>
      <h2>Enabled countries and API limits</h2>
      <table className="table"><tbody>{data.provider?.providerCountryConfigs.map((config) => <tr key={config.id}><td>{config.country.name}</td><td>{config.enabled ? "Enabled" : "Disabled"}</td><td>Requests/day: {config.maxRequestsPerDay ?? "n/a"}</td><td>Credits/day: {config.maxCreditsPerDay ?? "n/a"}</td></tr>)}</tbody></table>
    </>
  );
}
