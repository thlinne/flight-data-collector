import Link from "next/link";
import { apiGet } from "./api";

type OverviewMode = "last" | "yesterday" | "today" | "month";

type MatrixCell = {
  id: string;
  providerId: string;
  countryId: string;
  provider: { name: string; code: string; enabled: boolean; integrationStatus: string };
  country: { name: string; iso3: string; enabled: boolean };
  configEnabled: boolean;
  liveEnabled: boolean;
  effectiveEnabled: boolean;
  disabledReasons: string[];
  lastRunAt: string | null;
  lastRunSuccess: boolean | null;
  lastRunRecords: number | null;
  lastRunFlights: number | null;
  observationsYesterday: number;
  observationsToday: number;
  observationsThisMonth: number;
  flightsYesterday: number;
  flightsToday: number;
  flightsThisMonth: number;
};

function modeValue(cell: MatrixCell, mode: OverviewMode): string {
  if (mode === "last") return cell.lastRunRecords == null ? "-" : String(cell.lastRunRecords);
  if (mode === "yesterday") return String(cell.observationsYesterday);
  if (mode === "today") return String(cell.observationsToday);
  return String(cell.observationsThisMonth);
}

function flightModeValue(cell: MatrixCell, mode: OverviewMode): string {
  if (mode === "last") return cell.lastRunFlights == null ? "-" : String(cell.lastRunFlights);
  if (mode === "yesterday") return String(cell.flightsYesterday);
  if (mode === "today") return String(cell.flightsToday);
  return String(cell.flightsThisMonth);
}

function numericModeValue(cell: MatrixCell, mode: OverviewMode, kind: "observations" | "flights"): number | null {
  if (kind === "flights") {
    if (mode === "last") return cell.lastRunFlights;
    if (mode === "yesterday") return cell.flightsYesterday;
    if (mode === "today") return cell.flightsToday;
    return cell.flightsThisMonth;
  }
  if (mode === "last") return cell.lastRunRecords;
  if (mode === "yesterday") return cell.observationsYesterday;
  if (mode === "today") return cell.observationsToday;
  return cell.observationsThisMonth;
}

function cellStatus(cell: MatrixCell, mode: OverviewMode, kind: "observations" | "flights"): { label: string; className: string; title: string } {
  if (!cell.effectiveEnabled) {
    return {
      label: "OFF",
      className: "matrix-status is-off",
      title: cell.disabledReasons.length > 0 ? `Disabled: ${cell.disabledReasons.join(", ")}` : "Disabled"
    };
  }
  if (cell.lastRunSuccess === false) {
    return { label: "ERR", className: "matrix-status is-error", title: "Last fetch failed" };
  }
  const value = numericModeValue(cell, mode, kind);
  if (value == null) {
    return { label: "WAIT", className: "matrix-status is-empty", title: "No fetch run yet" };
  }
  if (value === 0) {
    const period = mode === "last" ? "last run" : mode === "yesterday" ? "yesterday" : mode === "today" ? "today" : "this month";
    return { label: "NO DATA", className: "matrix-status is-empty", title: `Active, but no ${kind === "flights" ? "flights" : "records"} for ${period}` };
  }
  return { label: "ON", className: "matrix-status is-on", title: "Active" };
}

export default async function OverviewPage({ searchParams }: { searchParams?: { mode?: string } }) {
  const mode: OverviewMode =
    searchParams?.mode === "yesterday" || searchParams?.mode === "today" || searchParams?.mode === "month" ? searchParams.mode : "last";
  const data = await apiGet<{
    today: number;
    thisWeek: number;
    thisMonth: number;
    activeCountries: number;
    activeProviders: number;
    failedLast24h: number;
    openCritical: number;
    countries: Array<{ id: string; name: string; iso3: string; enabled: boolean }>;
    matrixRows: MatrixCell[];
  }>("/overview", {
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    activeCountries: 0,
    activeProviders: 0,
    failedLast24h: 0,
    openCritical: 0,
    countries: [],
    matrixRows: []
  });

  const providers = Array.from(
    new Map(data.matrixRows.map((cell) => [cell.providerId, { id: cell.providerId, ...cell.provider }])).values()
  ).sort((left, right) => left.name.localeCompare(right.name));
  const countries = data.countries;
  const byProviderCountry = new Map(data.matrixRows.map((cell) => [`${cell.providerId}:${cell.countryId}`, cell]));

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
      <div className="section-heading">
        <h2>Data point matrix</h2>
        <div className="segmented-control">
          <Link className={mode === "last" ? "active" : ""} href="/?mode=last">Last run</Link>
          <Link className={mode === "yesterday" ? "active" : ""} href="/?mode=yesterday">Yesterday</Link>
          <Link className={mode === "today" ? "active" : ""} href="/?mode=today">Today</Link>
          <Link className={mode === "month" ? "active" : ""} href="/?mode=month">This month</Link>
        </div>
      </div>
      <div className="matrix-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Provider</th>
              {countries.map((country) => (
                <th key={country.id} title={country.enabled ? "Country enabled" : "Country disabled"}>{country.iso3}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <th>{provider.name}</th>
                {countries.map((country) => {
                  const cell = byProviderCountry.get(`${provider.id}:${country.id}`);
                  if (!cell) return <td key={country.id} className="matrix-cell is-missing"><span className="matrix-status is-off">N/A</span><strong>-</strong></td>;
                  const status = cellStatus(cell, mode, "observations");
                  return (
                    <td key={country.id} className="matrix-cell" title={status.title}>
                      <span className={status.className}>{status.label}</span>
                      <strong>{modeValue(cell, mode)}</strong>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section-heading">
        <h2>Flight matrix</h2>
      </div>
      <div className="matrix-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Provider</th>
              {countries.map((country) => (
                <th key={country.id} title={country.enabled ? "Country enabled" : "Country disabled"}>{country.iso3}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <th>{provider.name}</th>
                {countries.map((country) => {
                  const cell = byProviderCountry.get(`${provider.id}:${country.id}`);
                  if (!cell) return <td key={country.id} className="matrix-cell is-missing"><span className="matrix-status is-off">N/A</span><strong>-</strong></td>;
                  const status = cellStatus(cell, mode, "flights");
                  return (
                    <td key={country.id} className="matrix-cell" title={status.title}>
                      <span className={status.className}>{status.label}</span>
                      <strong>{flightModeValue(cell, mode)}</strong>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
