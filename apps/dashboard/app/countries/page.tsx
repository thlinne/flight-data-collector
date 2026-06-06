import { revalidatePath } from "next/cache";
import { apiGet, apiPatch } from "../api";

async function updateCountryStatus(formData: FormData) {
  "use server";
  const ids = formData.getAll("countryId").map(String);
  await Promise.all(
    ids.map((id) =>
      apiPatch(`/countries/${id}`, {
        enabled: formData.get(`enabled:${id}`) === "on",
        priority: String(formData.get(`priority:${id}`))
      })
    )
  );
  revalidatePath("/countries");
}

export default async function CountriesPage() {
  const countries = await apiGet<Array<{ id: string; name: string; iso3: string; enabled: boolean; priority: string; collectionAreas: Array<{ name: string; geometryQuality: string }> }>>("/countries", []);
  return (
    <>
      <h1 className="page-title">Country Dashboard</h1>
      <form action={updateCountryStatus}>
        <div className="toolbar"><button className="button">Save changes</button></div>
        <table className="table">
          <thead><tr><th>Country</th><th>Status</th><th>Priority</th><th>Geometry</th><th>Dashboard</th></tr></thead>
          <tbody>{countries.map((country) => <tr key={country.id}><td><input type="hidden" name="countryId" value={country.id} />{country.name} ({country.iso3})</td><td><label className="switch"><input name={`enabled:${country.id}`} type="checkbox" defaultChecked={country.enabled} /><span>{country.enabled ? "Enabled" : "Disabled"}</span></label></td><td><select name={`priority:${country.id}`} defaultValue={country.priority}><option value="LOW">LOW</option><option value="NORMAL">NORMAL</option><option value="HIGH">HIGH</option><option value="CRITICAL">CRITICAL</option></select></td><td title="Approximate bounding box: initial rectangular collection area, not an official FIR or polygon.">{country.collectionAreas[0]?.geometryQuality ?? "n/a"}</td><td><a className="button secondary" href={`/countries/${country.id}`}>Open</a></td></tr>)}</tbody>
        </table>
      </form>
    </>
  );
}
