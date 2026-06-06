export default function AnalyticsPage() {
  return (
    <>
      <h1 className="page-title">Analytics</h1>
      <section className="grid">
        <div className="card">Country/provider/day aggregates are not implemented yet.</div>
        <div className="card">Country/provider/hour aggregates are not implemented yet.</div>
        <div className="card">Aircraft/callsign aggregates are not implemented yet.</div>
        <div className="card">Provider overlap analysis is not implemented yet.</div>
      </section>
      <a className="button" href="/analytics/export/raw.csv">Export complete raw observation CSV</a>
    </>
  );
}
