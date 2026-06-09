import { apiGet } from "../../api";

type R1Report = {
  reportCode: "R1";
  title: string;
  provider: { id: string; code: string; name: string };
  date: string;
  countries: Array<{ id: string; iso3: string; name: string }>;
  rows: Array<{ hour: number; counts: Record<string, number> }>;
  totalsByCountry: Record<string, number>;
  totalFlights: number;
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

export default async function R1Page({ searchParams }: { searchParams?: { date?: string; providerId?: string } }) {
  const providers = await apiGet<Array<{ id: string; name: string; enabled: boolean }>>("/providers", []);
  const date = searchParams?.date ?? todayUtc();
  const providerId = searchParams?.providerId ?? providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id ?? "";
  const report = providerId
    ? await apiGet<R1Report | null>(`/reports/r1?date=${encodeURIComponent(date)}&providerId=${encodeURIComponent(providerId)}`, null)
    : null;
  const maxValue = report ? Math.max(1, ...report.rows.flatMap((row) => report.countries.map((country) => row.counts[country.id]))) : 1;

  return (
    <>
      <h1 className="page-title">R1 - One Day Overview, All Countries</h1>
      <section className="card">
        <form className="toolbar" action="/reports/r1" method="get">
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
                <path key={country.id} d={chartPath(report, country.id, maxValue, 840, 270)} transform="translate(50 30)" fill="none" stroke={chartColors[index % chartColors.length]} strokeWidth="2" />
              ))}
            </svg>
            <div className="report-legend">
              {report.countries.map((country, index) => (
                <span key={country.id}><i style={{ background: chartColors[index % chartColors.length] }} />{country.iso3} {country.name}</span>
              ))}
            </div>
          </section>
          <section className="card">
            <h2>Appendix - Assumptions and Decisions</h2>
            <ol>{report.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ol>
          </section>
        </>
      ) : (
        <section className="card">Select a provider and date to run R1.</section>
      )}
    </>
  );
}
