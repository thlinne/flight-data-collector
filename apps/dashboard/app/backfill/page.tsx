import { apiGet, apiPost } from "../api";

function datetimeLocalToUtcIso(value: FormDataEntryValue | null): string {
  const text = String(value ?? "");
  if (!text) return new Date().toISOString();
  return new Date(`${text.length === 16 ? `${text}:00` : text}Z`).toISOString();
}

async function queueHistoricalSnapshot(formData: FormData) {
  "use server";
  await apiPost("/historical-snapshot", {
    providerId: String(formData.get("providerId")),
    countryId: String(formData.get("countryId")),
    timestamp: datetimeLocalToUtcIso(formData.get("timestamp"))
  });
}

async function queueBackfill(formData: FormData) {
  "use server";
  await apiPost("/historical-backfill", {
    providerId: String(formData.get("providerId")),
    countryId: String(formData.get("countryId")),
    collectionAreaId: String(formData.get("collectionAreaId")),
    from: String(formData.get("from")),
    to: String(formData.get("to")),
    chunkSizeHours: Number(formData.get("chunkSizeHours"))
  });
}

export default async function BackfillPage() {
  const providers = await apiGet<Array<{ id: string; name: string }>>("/providers", []);
  const countries = await apiGet<Array<{ id: string; name: string; collectionAreas: Array<{ id: string; name: string }> }>>("/countries", []);
  const planeFinderId = providers.find((provider) => provider.name === "Plane Finder API")?.id ?? providers[0]?.id;
  const burundiId = countries.find((country) => country.name === "Burundi")?.id ?? countries[0]?.id;
  return (
    <>
      <h1 className="page-title">Historical Backfill</h1>
      <form className="card" action={queueHistoricalSnapshot}>
        <h2>Single historical snapshot</h2>
        <div className="toolbar">
          <select name="providerId" defaultValue={planeFinderId}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
          <select name="countryId" defaultValue={burundiId}>{countries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}</select>
          <input name="timestamp" type="datetime-local" defaultValue="2025-12-15T12:00" />
          <button className="button">Queue snapshot</button>
        </div>
      </form>
      <form className="card" action={queueBackfill}>
        <h2>Backfill placeholder</h2>
        <div className="toolbar">
          <select name="providerId">{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
          <select name="countryId">{countries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}</select>
          <select name="collectionAreaId">{countries.flatMap((country) => country.collectionAreas).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
          <input name="from" type="datetime-local" />
          <input name="to" type="datetime-local" />
          <input name="chunkSizeHours" type="number" defaultValue="24" min="1" />
          <button className="button">Queue job</button>
        </div>
      </form>
    </>
  );
}
