import { apiGet } from "../../api";

type R2Report = {
  reportCode: "R2";
  title: string;
  provider: { id: string; code: string; name: string };
  country: { id: string; iso3: string; name: string };
  date: string;
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
    enrichment: {
      status: string;
      matchedNumber: string | null;
      origin: { iata: string | null; icao: string | null; name: string | null; scheduledUtc: string | null } | null;
      destination: { iata: string | null; icao: string | null; name: string | null; scheduledUtc: string | null } | null;
      airline: { name: string | null; iata: string | null; icao: string | null } | null;
      aircraftModel: string | null;
      flightStatus: string | null;
      reusedFromCache: boolean;
      errorMessage: string | null;
    } | null;
    observations: Array<{ observedAt: string; latitude: number; longitude: number; altitudeFt: number | null; groundSpeedKt: number | null; headingDeg: number | null }>;
  }>;
  assumptions: string[];
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function R2Page({ searchParams }: { searchParams?: { date?: string; providerId?: string; countryId?: string; run?: string; enrich?: string } }) {
  const providers = await apiGet<Array<{ id: string; name: string; enabled: boolean }>>("/providers", []);
  const countries = await apiGet<Array<{ id: string; name: string; iso3: string; enabled: boolean }>>("/countries", []);
  const date = searchParams?.date ?? todayUtc();
  const providerId = searchParams?.providerId ?? providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id ?? "";
  const countryId = searchParams?.countryId ?? countries.find((country) => country.enabled)?.id ?? countries[0]?.id ?? "";
  const enrich = searchParams?.enrich ?? "true";
  const report =
    searchParams?.run === "1" && providerId && countryId
      ? await apiGet<R2Report | null>(`/reports/r2?date=${encodeURIComponent(date)}&providerId=${encodeURIComponent(providerId)}&countryId=${encodeURIComponent(countryId)}&enrich=${encodeURIComponent(enrich)}`, null)
      : null;

  return (
    <>
      <h1 className="page-title">R2 - One Day Detail, One Country</h1>
      <section className="card report-chart-card">
        <form className="toolbar" action="/reports/r2" method="get">
          <input type="hidden" name="run" value="1" />
          <label>
            UTC date
            <input type="date" name="date" defaultValue={date} required />
          </label>
          <label>
            Provider
            <select name="providerId" defaultValue={providerId} required>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </label>
          <label>
            Country
            <select name="countryId" defaultValue={countryId} required>
              {countries.map((country) => (
                <option key={country.id} value={country.id}>{country.iso3} - {country.name}</option>
              ))}
            </select>
          </label>
          <label>
            AeroDataBox enrichment
            <select name="enrich" defaultValue={enrich}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <button className="button" type="submit">Run R2</button>
          {report ? (
            <>
              <a className="button secondary" href={`/reports/export/r2.pdf?date=${encodeURIComponent(date)}&providerId=${encodeURIComponent(providerId)}&countryId=${encodeURIComponent(countryId)}&enrich=${encodeURIComponent(enrich)}`}>Export PDF</a>
              <a className="button secondary" href={`/reports/export/r2.xlsx?date=${encodeURIComponent(date)}&providerId=${encodeURIComponent(providerId)}&countryId=${encodeURIComponent(countryId)}&enrich=${encodeURIComponent(enrich)}`}>Export XLSX</a>
            </>
          ) : null}
        </form>
      </section>

      {report ? (
        <>
          <section className="grid report-meta">
            <div className="card metric">Provider<strong>{report.provider.name}</strong></div>
            <div className="card metric">Country<strong>{report.country.name}</strong></div>
            <div className="card metric">Data points<strong>{report.totalDataPoints}</strong></div>
            <div className="card metric">Detected flights<strong>{report.totalFlights}</strong></div>
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
                  {report.hourlyDataPoints.map((count, hour) => <td key={hour}>{count}</td>)}
                </tr>
                <tr>
                  <th>Detected flights</th>
                  {report.hourlyFlights.map((count, hour) => <td key={hour}>{count}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <section className="card report-chart-card">
            <h2>Hourly flight count</h2>
            <svg className="report-line-chart" viewBox="0 0 920 320" role="img" aria-label="Hourly flight count">
              <line x1="50" y1="260" x2="890" y2="260" stroke="#64748b" strokeWidth="1" />
              <line x1="50" y1="30" x2="50" y2="260" stroke="#64748b" strokeWidth="1" />
              {report.hourlyFlights.map((count, hour) => {
                const max = Math.max(1, ...report.hourlyFlights);
                const x = 50 + (hour / 23) * 840;
                const y = 260 - (count / max) * 230;
                const next = report.hourlyFlights[hour + 1];
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
            {report.flights.map((flight, index) => (
              <article key={flight.id} className="report-flight-detail">
                <h3>{index + 1}. {flight.callsign ?? "Unknown callsign"}</h3>
                <p>ICAO24 {flight.icao24 ?? "-"} | Aircraft {flight.aircraftTypeIcao ?? "-"} | Observed {flight.firstObservedAt} to {flight.lastObservedAt}</p>
                <p>
                  ADB enrichment: {flight.enrichment?.status ?? "NOT_REQUESTED"}
                  {flight.enrichment?.reusedFromCache ? " (cached)" : ""}
                  {flight.enrichment?.matchedNumber ? ` | flight ${flight.enrichment.matchedNumber}` : ""}
                  {flight.enrichment?.origin || flight.enrichment?.destination
                    ? ` | route ${flight.enrichment?.origin?.iata ?? flight.enrichment?.origin?.icao ?? "?"} -> ${flight.enrichment?.destination?.iata ?? flight.enrichment?.destination?.icao ?? "?"}`
                    : ""}
                </p>
                {flight.enrichment?.airline?.name || flight.enrichment?.aircraftModel ? (
                  <p>
                    Airline {flight.enrichment?.airline?.name ?? "-"} | Aircraft {flight.enrichment?.aircraftModel ?? "-"} | Status {flight.enrichment?.flightStatus ?? "-"}
                    {flight.enrichment?.origin?.scheduledUtc ? ` | dep ${flight.enrichment.origin.scheduledUtc}` : ""}
                    {flight.enrichment?.destination?.scheduledUtc ? ` | arr ${flight.enrichment.destination.scheduledUtc}` : ""}
                  </p>
                ) : null}
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
            <ol>{report.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ol>
          </section>
        </>
      ) : (
        <section className="card">Select provider, country and date to run R2.</section>
      )}
    </>
  );
}
