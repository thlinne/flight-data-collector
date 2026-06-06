import { revalidatePath } from "next/cache";
import { apiGet, apiPost } from "../api";

async function cleanupMockData() {
  "use server";
  await apiPost("/admin/cleanup/mock-data", {});
  revalidatePath("/raw");
}

export default async function RawPage({
  searchParams
}: {
  searchParams?: { providerId?: string; countryId?: string; icao24?: string; callsign?: string };
}) {
  const providers = await apiGet<Array<{ id: string; name: string }>>("/providers", []);
  const countries = await apiGet<Array<{ id: string; name: string }>>("/countries", []);
  const params = new URLSearchParams();
  if (searchParams?.providerId) params.set("providerId", searchParams.providerId);
  if (searchParams?.countryId) params.set("countryId", searchParams.countryId);
  if (searchParams?.icao24) params.set("icao24", searchParams.icao24);
  if (searchParams?.callsign) params.set("callsign", searchParams.callsign);
  const rows = await apiGet<Array<{ id: string; observedAt: string; icao24: string | null; callsign: string | null; provider: { name: string }; countryTags: Array<{ country: { name: string } }>; rawRecordJson: unknown }>>(`/raw${params.size ? `?${params.toString()}` : ""}`, []);
  const sortedProviders = [...providers].sort((a, b) => a.name.localeCompare(b.name));
  const sortedCountries = [...countries].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <h1 className="page-title">Raw Data Explorer</h1>
      <form className="toolbar">
        <select name="providerId" defaultValue={searchParams?.providerId ?? ""}>
          <option value="">All providers</option>
          {sortedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select>
        <select name="countryId" defaultValue={searchParams?.countryId ?? ""}>
          <option value="">All countries</option>
          {sortedCountries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}
        </select>
        <input name="icao24" placeholder="ICAO24" defaultValue={searchParams?.icao24 ?? ""} />
        <input name="callsign" placeholder="Callsign" defaultValue={searchParams?.callsign ?? ""} />
        <button className="button">Apply filters</button>
        <a className="button secondary" href="/raw">Clear</a>
      </form>
      <form className="toolbar" action={cleanupMockData}>
        <button className="button secondary">Delete all Mock data</button>
      </form>
      <table className="table">
        <thead><tr><th>Observed</th><th>Provider</th><th>Country</th><th>ICAO24</th><th>Callsign</th><th>Raw JSON</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td>{row.observedAt}</td><td>{row.provider.name}</td><td>{row.countryTags.map((tag) => tag.country.name).join(", ")}</td><td>{row.icao24}</td><td>{row.callsign}</td><td><pre>{JSON.stringify(row.rawRecordJson, null, 2)}</pre></td></tr>)}</tbody>
      </table>
    </>
  );
}
