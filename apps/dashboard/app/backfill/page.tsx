import { apiGet, apiPost } from "../api";

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
  return (
    <>
      <h1 className="page-title">Historical Backfill</h1>
      <form className="card" action={queueBackfill}>
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
