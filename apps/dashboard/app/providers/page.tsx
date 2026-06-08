import { revalidatePath } from "next/cache";
import { apiGet, apiPatch } from "../api";

async function updateProviderStatus(formData: FormData) {
  "use server";
  const ids = formData.getAll("providerId").map(String);
  await Promise.all(
    ids.map((id) =>
      apiPatch(`/providers/${id}`, {
        enabled: formData.get(`enabled:${id}`) === "on"
      })
    )
  );
  revalidatePath("/providers");
}

export default async function ProvidersPage() {
  const providers = await apiGet<Array<{ id: string; name: string; code: string; enabled: boolean; supportsLive: boolean; supportsHistorical: boolean }>>("/providers", []);
  return (
    <>
      <h1 className="page-title">Providers</h1>
      <form action={updateProviderStatus}>
        <div className="toolbar"><button className="button">Save changes</button></div>
        <table className="table">
          <thead><tr><th>Provider</th><th>Status</th><th>Capabilities</th></tr></thead>
          <tbody>{providers.map((provider) => <tr key={provider.id}><td><input type="hidden" name="providerId" value={provider.id} />{provider.name} ({provider.code})</td><td><label className="switch"><input name={`enabled:${provider.id}`} type="checkbox" defaultChecked={provider.enabled} /><span>{provider.enabled ? "Enabled" : "Disabled"}</span></label></td><td>{provider.supportsLive ? "Live" : ""} {provider.supportsHistorical ? "Historical" : ""}</td></tr>)}</tbody>
        </table>
      </form>
    </>
  );
}
