import { revalidatePath } from "next/cache";
import { apiGet, apiPatch } from "../api";

function nullableNumber(formData: FormData, key: string): number | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : Number(value);
}

async function updateConfig(formData: FormData) {
  "use server";
  const ids = formData.getAll("configId").map(String);
  await Promise.all(
    ids.map((id) =>
      apiPatch(`/configs/${id}`, {
        enabled: formData.get(`enabled:${id}`) === "on",
        liveEnabled: formData.get(`liveEnabled:${id}`) === "on",
        historicalEnabled: formData.get(`historicalEnabled:${id}`) === "on",
        livePollingIntervalSeconds: Number(formData.get(`livePollingIntervalSeconds:${id}`)),
        liveLatitude: nullableNumber(formData, `liveLatitude:${id}`),
        liveLongitude: nullableNumber(formData, `liveLongitude:${id}`),
        liveRadiusNm: nullableNumber(formData, `liveRadiusNm:${id}`),
        maxRequestsPerHour: nullableNumber(formData, `maxRequestsPerHour:${id}`),
        maxCreditsPerDay: nullableNumber(formData, `maxCreditsPerDay:${id}`)
      })
    )
  );
  revalidatePath("/control");
}

export default async function ControlPage() {
  const configs = await apiGet<Array<{ id: string; providerId: string; enabled: boolean; liveEnabled: boolean; historicalEnabled: boolean; livePollingIntervalSeconds: number; liveLatitude: number | null; liveLongitude: number | null; liveRadiusNm: number | null; maxRequestsPerMinute: number | null; maxRequestsPerHour: number | null; maxRequestsPerDay: number | null; maxCreditsPerDay: number | null; provider: { name: string; enabled: boolean }; country: { name: string; enabled: boolean } }>>("/configs", []);
  return (
    <>
      <h1 className="page-title">Collection Control</h1>
      <form action={updateConfig}>
        <div className="toolbar"><button className="button">Save changes</button></div>
        <table className="table">
          <thead><tr><th>Country</th><th>Provider</th><th>Effective</th><th>Enabled</th><th>Live</th><th>Historical</th><th>Interval</th><th>Lat</th><th>Lon</th><th>Radius NM</th><th>Req/hour</th><th>Credits/day</th></tr></thead>
          <tbody>{configs.map((config) => {
            const effective = config.enabled && config.liveEnabled && config.provider.enabled && config.country.enabled;
            const blockedBy = [
              config.provider.enabled ? null : "Provider",
              config.country.enabled ? null : "Country",
              config.enabled ? null : "Config",
              config.liveEnabled ? null : "Live"
            ].filter(Boolean).join(", ");
            return <tr key={config.id}><td><input type="hidden" name="configId" value={config.id} />{config.country.name}</td><td>{config.provider.name}</td><td>{effective ? "Active" : `Inactive${blockedBy ? `: ${blockedBy}` : ""}`}</td><td><input name={`enabled:${config.id}`} type="checkbox" defaultChecked={config.enabled} /></td><td><input name={`liveEnabled:${config.id}`} type="checkbox" defaultChecked={config.liveEnabled} /></td><td><input name={`historicalEnabled:${config.id}`} type="checkbox" defaultChecked={config.historicalEnabled} /></td><td><input name={`livePollingIntervalSeconds:${config.id}`} type="number" min="1" defaultValue={config.livePollingIntervalSeconds} /></td><td><input name={`liveLatitude:${config.id}`} type="number" step="0.0001" defaultValue={config.liveLatitude ?? ""} /></td><td><input name={`liveLongitude:${config.id}`} type="number" step="0.0001" defaultValue={config.liveLongitude ?? ""} /></td><td><input name={`liveRadiusNm:${config.id}`} type="number" min="1" defaultValue={config.liveRadiusNm ?? ""} /></td><td><input name={`maxRequestsPerHour:${config.id}`} type="number" min="0" defaultValue={config.maxRequestsPerHour ?? ""} /></td><td><input name={`maxCreditsPerDay:${config.id}`} type="number" min="0" defaultValue={config.maxCreditsPerDay ?? ""} /></td></tr>;
          })}</tbody>
        </table>
      </form>
    </>
  );
}
