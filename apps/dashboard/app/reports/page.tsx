import { apiGet } from "../api";

type R1Report = {
  reportCode: "R1";
  title: string;
  provider: { id: string; code: string; name: string };
  date: string;
  windowStart: string;
  windowEnd: string;
  countries: Array<{ id: string; iso3: string; name: string }>;
  rows: Array<{ hour: number; windowStart: string; windowEnd: string; counts: Record<string, number> }>;
  totalsByCountry: Record<string, number>;
  totalFlights: number;
  generatedAt: string;
  assumptions: string[];
};

type R2Report = {
  reportCode: "R2";
  title: string;
  provider: { id: string; code: string; name: string };
  country: { id: string; iso3: string; name: string };
  date: string;
  windowStart: string;
  windowEnd: string;
  hourlyDataPoints: number[];
  hourlyFlights: number[];
  totalDataPoints: number;
  totalFlights: number;
  flights: Array<{
    id: string;
    callsign: string | null;
    providerFlightId: string | null;
    icao24: string | null;
    registration: string | null;
    aircraftTypeIcao: string | null;
    operatorName: string | null;
    firstObservedAt: string;
    lastObservedAt: string;
    observationCount: number;
    observedOriginAirportCode: string | null;
    observedDestinationAirportCode: string | null;
    enrichment: { status: string; candidateCount: number; errorMessage: string | null; selectedCandidate: unknown } | null;
    observations: Array<{ observedAt: string; latitude: number; longitude: number; altitudeFt: number | null; groundSpeedKt: number | null; headingDeg: number | null }>;
  }>;
  generatedAt: string;
  assumptions: string[];
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function chartPath(report: R1Report, countryId: string, maxValue: number, width: number, height: number): string {
  return report.rows
    .map((row, index) => {
      const x = (row.hour / 23) * width;
      const y = height - (row.counts[countryId] / maxValue) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

const chartColors = ["#0f766e", "#1d4ed8", "#b45309", "#7c3aed", "#be123c", "#0369a1", "#15803d", "#a21caf", "#334155", "#ca8a04"];

export default async function ReportsPage({ searchParams }: { searchParams?: { date?: string; providerId?: string; r2Date?: string; r2ProviderId?: string; r2CountryId?: string; runR2?: string; enrich?: string } }) {
  const providers = await apiGet<Array<{ id: string; name: string; code: string; enabled: boolean }>>("/providers", []);
  const countries = await apiGet<Array<{ id: string; name: string; iso3: string; enabled: boolean }>>("/countries", []);
  const date = searchParams?.date ?? todayUtc();
  const providerId = searchParams?.providerId ?? providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id ?? "";
  const report = providerId
    ? await apiGet<R1Report | null>(`/reports/r1?date=${encodeURIComponent(date)}&providerId=${encodeURIComponent(providerId)}`, null)
    : null;
  const maxValue = report ? Math.max(1, ...report.rows.flatMap((row) => report.countries.map((country) => row.counts[country.id]))) : 1;
  const r2Date = searchParams?.r2Date ?? date;
  const r2ProviderId = searchParams?.r2ProviderId ?? providerId;
  const r2CountryId = searchParams?.r2CountryId ?? countries.find((country) => country.enabled)?.id ?? countries[0]?.id ?? "";
  const r2Enrich = searchParams?.enrich ?? "true";
  const r2Report =
    searchParams?.runR2 === "1" && r2ProviderId && r2CountryId
      ? await apiGet<R2Report | null>(
          `/reports/r2?date=${encodeURIComponent(r2Date)}&providerId=${encodeURIComponent(r2ProviderId)}&countryId=${encodeURIComponent(r2CountryId)}&enrich=${encodeURIComponent(r2Enrich)}`,
          null
        )
      : null;

  return (
    <>
      <h1 className="page-title">Reports</h1>
      <section id="r1" className="card">
        <h2>R1 - One Day Overview, All Countries</h2>
        <form className="toolbar" action="/reports" method="get">
          <label>
            UTC date
            <input type="date" name="date" defaultValue={date} required />
          </label>
          <label>
            Provider
            <select name="providerId" defaultValue={providerId} required>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button" type="submit">Run report</button>
          {report ? (
            <>
              <a className="button secondary" href={`/reports/export/r1.pdf?date=${encodeURIComponent(date)}&providerId=${encodeURIComponent(providerId)}`}>Export PDF</a>
              <a className="button secondary" href={`/reports/export/r1.xlsx?date=${encodeURIComponent(date)}&providerId=${encodeURIComponent(providerId)}`}>Export XLSX</a>
            </>
          ) : null}
        </form>
      </section>

      {report ? (
        <>
          <section className="grid report-meta">
            <div className="card metric">Provider<strong>{report.provider.name}</strong></div>
            <div className="card metric">UTC date<strong>{report.date}</strong></div>
            <div className="card metric">Detected flights<strong>{report.totalFlights}</strong></div>
            <div className="card metric">Generated at<strong>{report.generatedAt}</strong></div>
          </section>

          <section className="section-heading">
            <h2>Hourly flight matrix</h2>
          </section>
          <div className="matrix-scroll">
            <table className="matrix-table report-hourly-table">
              <thead>
                <tr>
                  <th>Hour UTC</th>
                  {report.countries.map((country) => (
                    <th key={country.id} title={country.name}>{country.iso3}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.hour}>
                    <th>{String(row.hour).padStart(2, "0")}:00</th>
                    {report.countries.map((country) => (
                      <td key={country.id}>{row.counts[country.id]}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th>Total</th>
                  {report.countries.map((country) => (
                    <td key={country.id}><strong>{report.totalsByCountry[country.id]}</strong></td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <section className="card report-chart-card">
            <h2>Hourly flight count by country</h2>
            <svg className="report-line-chart" viewBox="0 0 920 360" role="img" aria-label="Hourly flight count by country">
              <line x1="50" y1="300" x2="890" y2="300" stroke="#64748b" strokeWidth="1" />
              <line x1="50" y1="30" x2="50" y2="300" stroke="#64748b" strokeWidth="1" />
              {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((hour) => {
                const x = 50 + (hour / 23) * 840;
                return (
                  <g key={hour}>
                    <line x1={x} y1="30" x2={x} y2="300" stroke="#e2e8f0" strokeWidth="1" />
                    <text x={x} y="322" textAnchor="middle" fontSize="11" fill="#475569">{hour}</text>
                  </g>
                );
              })}
              <text x="58" y="42" fontSize="11" fill="#475569">Max {maxValue}</text>
              {report.countries.map((country, index) => (
                <path
                  key={country.id}
                  d={chartPath(report, country.id, maxValue, 840, 270)}
                  transform="translate(50 30)"
                  fill="none"
                  stroke={chartColors[index % chartColors.length]}
                  strokeWidth="2"
                />
              ))}
            </svg>
            <div className="report-legend">
              {report.countries.map((country, index) => (
                <span key={country.id}>
                  <i style={{ background: chartColors[index % chartColors.length] }} />
                  {country.iso3} {country.name}
                </span>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Appendix - Assumptions and Decisions</h2>
            <ol>
              {report.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <section className="card">Select a provider and date to run R1.</section>
      )}

      <section id="r2" className="card report-chart-card">
        <h2>R2 - One Day Detail, One Country</h2>
        <form className="toolbar" action="/reports" method="get">
          <input type="hidden" name="runR2" value="1" />
          <label>
            UTC date
            <input type="date" name="r2Date" defaultValue={r2Date} required />
          </label>
          <label>
            Provider
            <select name="r2ProviderId" defaultValue={r2ProviderId} required>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Country
            <select name="r2CountryId" defaultValue={r2CountryId} required>
              {countries.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.iso3} - {country.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Google Flights enrichment
            <select name="enrich" defaultValue={r2Enrich}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <button className="button" type="submit">Run R2</button>
          {r2Report ? (
            <>
              <a className="button secondary" href={`/reports/export/r2.pdf?date=${encodeURIComponent(r2Date)}&providerId=${encodeURIComponent(r2ProviderId)}&countryId=${encodeURIComponent(r2CountryId)}&enrich=${encodeURIComponent(r2Enrich)}`}>Export PDF</a>
              <a className="button secondary" href={`/reports/export/r2.xlsx?date=${encodeURIComponent(r2Date)}&providerId=${encodeURIComponent(r2ProviderId)}&countryId=${encodeURIComponent(r2CountryId)}&enrich=${encodeURIComponent(r2Enrich)}`}>Export XLSX</a>
            </>
          ) : null}
        </form>
      </section>

      {r2Report ? (
        <>
          <section className="grid report-meta">
            <div className="card metric">Provider<strong>{r2Report.provider.name}</strong></div>
            <div className="card metric">Country<strong>{r2Report.country.name}</strong></div>
            <div className="card metric">Data points<strong>{r2Report.totalDataPoints}</strong></div>
            <div className="card metric">Detected flights<strong>{r2Report.totalFlights}</strong></div>
          </section>
          <div className="matrix-scroll">
            <table className="matrix-table report-hourly-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  {Array.from({ length: 24 }, (_, hour) => <th key={hour}>{String(hour).padStart(2, "0")}:00</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Data points</th>
                  {r2Report.hourlyDataPoints.map((count, hour) => <td key={hour}>{count}</td>)}
                </tr>
                <tr>
                  <th>Detected flights</th>
                  {r2Report.hourlyFlights.map((count, hour) => <td key={hour}>{count}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <section className="card report-chart-card">
            <h2>Hourly flight count</h2>
            <svg className="report-line-chart" viewBox="0 0 920 320" role="img" aria-label="Hourly flight count">
              <line x1="50" y1="260" x2="890" y2="260" stroke="#64748b" strokeWidth="1" />
              <line x1="50" y1="30" x2="50" y2="260" stroke="#64748b" strokeWidth="1" />
              {r2Report.hourlyFlights.map((count, hour) => {
                const max = Math.max(1, ...r2Report.hourlyFlights);
                const x = 50 + (hour / 23) * 840;
                const y = 260 - (count / max) * 230;
                const next = r2Report.hourlyFlights[hour + 1];
                if (next == null) return null;
                const x2 = 50 + ((hour + 1) / 23) * 840;
                const y2 = 260 - (next / max) * 230;
                return <line key={hour} x1={x} y1={y} x2={x2} y2={y2} stroke="#0f766e" strokeWidth="2" />;
              })}
              {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((hour) => {
                const x = 50 + (hour / 23) * 840;
                return <text key={hour} x={x} y="286" textAnchor="middle" fontSize="11" fill="#475569">{hour}</text>;
              })}
            </svg>
          </section>
          <section className="card report-chart-card">
            <h2>Flight details</h2>
            {r2Report.flights.map((flight, index) => (
              <article key={flight.id} className="report-flight-detail">
                <h3>{index + 1}. {flight.callsign ?? "Unknown callsign"}</h3>
                <p>
                  ICAO24 {flight.icao24 ?? "-"} | Aircraft {flight.aircraftTypeIcao ?? "-"} | Observed {flight.firstObservedAt} to {flight.lastObservedAt}
                </p>
                <p>
                  Route fields: {flight.observedOriginAirportCode ?? "-"} to {flight.observedDestinationAirportCode ?? "-"} | Google Flights enrichment: {flight.enrichment?.status ?? "NOT_REQUESTED"} ({flight.enrichment?.candidateCount ?? 0} candidates)
                </p>
                {flight.enrichment?.errorMessage ? <p className="status-warning">{flight.enrichment.errorMessage}</p> : null}
                <table className="table">
                  <thead>
                    <tr>
                      <th>Timestamp UTC</th>
                      <th>Latitude</th>
                      <th>Longitude</th>
                      <th>Altitude ft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flight.observations.map((observation) => (
                      <tr key={`${flight.id}-${observation.observedAt}-${observation.latitude}-${observation.longitude}`}>
                        <td>{observation.observedAt}</td>
                        <td>{observation.latitude.toFixed(5)}</td>
                        <td>{observation.longitude.toFixed(5)}</td>
                        <td>{observation.altitudeFt ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            ))}
          </section>
          <section className="card">
            <h2>Appendix - Assumptions and Decisions</h2>
            <ol>
              {r2Report.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </>
  );
}
