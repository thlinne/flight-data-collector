import { apiGet } from "../../api";

export default async function CountryDetailPage({ params }: { params: { id: string } }) {
  const data = await apiGet<{
    country: { name: string; providerCountryConfigs: Array<{ id: string; liveEnabled: boolean; livePollingIntervalSeconds: number; provider: { name: string } }> } | null;
    observations: number;
    lastObservation: { observedAt: string } | null;
  }>(`/country/${params.id}`, { country: null, observations: 0, lastObservation: null });
  return (
    <>
      <h1 className="page-title">{data.country?.name ?? "Country Dashboard"}</h1>
      <section className="grid">
        <div className="card metric">Raw observations<strong>{data.observations}</strong></div>
        <div className="card metric">Last observation<strong>{data.lastObservation?.observedAt ?? "none"}</strong></div>
      </section>
      <h2>Live status per provider</h2>
      <table className="table"><tbody>{data.country?.providerCountryConfigs.map((config) => <tr key={config.id}><td>{config.provider.name}</td><td>{config.liveEnabled ? "Live enabled" : "Live disabled"}</td><td>{config.livePollingIntervalSeconds}s</td></tr>)}</tbody></table>
    </>
  );
}
