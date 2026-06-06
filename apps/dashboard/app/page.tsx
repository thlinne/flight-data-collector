import { apiGet } from "./api";

export default async function OverviewPage() {
  const data = await apiGet<{
    today: number;
    thisWeek: number;
    thisMonth: number;
    activeCountries: number;
    activeProviders: number;
    failedLast24h: number;
    openCritical: number;
    providerCountryRows: Array<{
      id: string;
      provider: { name: string };
      country?: { name: string } | null;
      lastFetchAt: string;
      lastRecordCount: number;
      observationsToday: number;
      observationsThisMonth: number;
    }>;
  }>("/overview", { today: 0, thisWeek: 0, thisMonth: 0, activeCountries: 0, activeProviders: 0, failedLast24h: 0, openCritical: 0, providerCountryRows: [] });

  return (
    <>
      <h1 className="page-title">Overview</h1>
      <section className="grid">
        <div className="card metric">Observations this week<strong>{data.thisWeek}</strong></div>
        <div className="card metric">Active countries<strong>{data.activeCountries}</strong></div>
        <div className="card metric">Active providers<strong>{data.activeProviders}</strong></div>
        <div className="card metric">Failed fetches 24h<strong>{data.failedLast24h}</strong></div>
        <div className="card metric">Open critical alerts<strong>{data.openCritical}</strong></div>
      </section>
      <h2>Provider-country activity</h2>
      <div className="overview-matrix">
        <div className="overview-total muted-cell"></div>
        <div className="overview-total muted-cell"></div>
        <div className="overview-total muted-cell"></div>
        <div className="overview-total muted-cell"></div>
        <div className="overview-total metric">Total today<strong>{data.today}</strong></div>
        <div className="overview-total metric">Total this month<strong>{data.thisMonth}</strong></div>
        <div className="overview-head">Provider</div>
        <div className="overview-head">Country</div>
        <div className="overview-head">Last fetch</div>
        <div className="overview-head">Last observations</div>
        <div className="overview-head">Today</div>
        <div className="overview-head">This month</div>
        {data.providerCountryRows.map((row) => (
          <div className="overview-row" key={row.id}>
            <div>{row.provider.name}</div>
            <div>{row.country?.name ?? "n/a"}</div>
            <div>{row.lastFetchAt}</div>
            <div>{row.lastRecordCount}</div>
            <div>{row.observationsToday}</div>
            <div>{row.observationsThisMonth}</div>
          </div>
        ))}
      </div>
    </>
  );
}
