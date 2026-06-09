import Link from "next/link";

export default function ReportsPage() {
  return (
    <>
      <h1 className="page-title">Reports</h1>
      <section className="grid">
        <Link className="card report-link-card" href="/reports/r1">
          <h2>R1 - One Day Overview</h2>
          <p>All countries for one UTC day and one provider.</p>
        </Link>
        <Link className="card report-link-card" href="/reports/r2">
          <h2>R2 - One Day Detail</h2>
          <p>One country for one UTC day and one provider, including optional flight enrichment.</p>
        </Link>
      </section>
    </>
  );
}
