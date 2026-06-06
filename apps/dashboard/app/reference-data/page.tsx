import { revalidatePath } from "next/cache";
import { apiGet, apiPatch, apiPost } from "../api";

type ReferenceDataSource = "OURAIRPORTS" | "OPENSKY_AIRCRAFT" | "OPENFLIGHTS" | "WIKIDATA";

type ReferenceDataConfig = {
  id: string;
  source: ReferenceDataSource;
  enabled: boolean;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  timeOfDayLocal: string;
  timezone: string;
};

type ReferenceDataRun = {
  id: string;
  source: ReferenceDataSource;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  recordsSeen: number;
  recordsUpserted: number;
  errorMessage: string | null;
};

type ReferenceDataResponse = {
  configs: ReferenceDataConfig[];
  recentRuns: ReferenceDataRun[];
  counts: {
    ourAirportsAirports: number;
    openSkyAircraft: number;
    openFlightsAirports: number;
    openFlightsAirlines: number;
    openFlightsRoutes: number;
    wikidataEntities: number;
    observedProviderIdentities: number;
  };
};

const sourceLabels: Record<ReferenceDataSource, string> = {
  OURAIRPORTS: "OurAirports airports",
  OPENSKY_AIRCRAFT: "OpenSky aircraft registry",
  OPENFLIGHTS: "OpenFlights airports, airlines, routes",
  WIKIDATA: "Wikidata placeholder"
};

const weekdays = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"]
] as const;

async function saveReferenceDataConfig(formData: FormData) {
  "use server";
  const ids = formData.getAll("configId").map(String);
  await Promise.all(
    ids.map((id) =>
      apiPatch(`/reference-data/configs/${id}`, {
        enabled: formData.get(`enabled:${id}`) === "on",
        monday: formData.get(`monday:${id}`) === "on",
        tuesday: formData.get(`tuesday:${id}`) === "on",
        wednesday: formData.get(`wednesday:${id}`) === "on",
        thursday: formData.get(`thursday:${id}`) === "on",
        friday: formData.get(`friday:${id}`) === "on",
        saturday: formData.get(`saturday:${id}`) === "on",
        sunday: formData.get(`sunday:${id}`) === "on",
        timeOfDayLocal: String(formData.get(`timeOfDayLocal:${id}`) ?? "03:30")
      })
    )
  );
  revalidatePath("/reference-data");
}

async function runManualSync(formData: FormData) {
  "use server";
  await apiPost("/reference-data/sync", { source: formData.get("source") });
  revalidatePath("/reference-data");
}

export default async function ReferenceDataPage() {
  const data = await apiGet<ReferenceDataResponse>(
    "/reference-data",
    {
      configs: [],
      recentRuns: [],
      counts: {
        ourAirportsAirports: 0,
        openSkyAircraft: 0,
        openFlightsAirports: 0,
        openFlightsAirlines: 0,
        openFlightsRoutes: 0,
        wikidataEntities: 0,
        observedProviderIdentities: 0
      }
    }
  );

  return (
    <>
      <h1 className="page-title">Reference Data</h1>
      <div className="grid">
        <div className="card"><div className="metric">OurAirports airports<strong>{data.counts.ourAirportsAirports}</strong></div></div>
        <div className="card"><div className="metric">OpenSky aircraft<strong>{data.counts.openSkyAircraft}</strong></div></div>
        <div className="card"><div className="metric">OpenFlights airports<strong>{data.counts.openFlightsAirports}</strong></div></div>
        <div className="card"><div className="metric">OpenFlights airlines<strong>{data.counts.openFlightsAirlines}</strong></div></div>
        <div className="card"><div className="metric">OpenFlights routes<strong>{data.counts.openFlightsRoutes}</strong></div></div>
        <div className="card"><div className="metric">Provider identities<strong>{data.counts.observedProviderIdentities}</strong></div></div>
      </div>

      <h2>Sync schedule</h2>
      <form action={saveReferenceDataConfig}>
        <div className="toolbar"><button className="button">Save schedule</button></div>
        <table className="table">
          <thead>
            <tr><th>Source</th><th>Enabled</th><th>Days</th><th>Time</th><th>Timezone</th><th>Manual</th></tr>
          </thead>
          <tbody>
            {data.configs.map((config) => (
              <tr key={config.id}>
                <td><input type="hidden" name="configId" value={config.id} />{sourceLabels[config.source]}</td>
                <td><input name={`enabled:${config.id}`} type="checkbox" defaultChecked={config.enabled} /></td>
                <td>
                  <div className="weekday-row">
                    {weekdays.map(([key, label]) => (
                      <label key={key} className="weekday-toggle">
                        <input name={`${key}:${config.id}`} type="checkbox" defaultChecked={config[key]} /> {label}
                      </label>
                    ))}
                  </div>
                </td>
                <td><input name={`timeOfDayLocal:${config.id}`} type="time" defaultValue={config.timeOfDayLocal} /></td>
                <td>{config.timezone}</td>
                <td>
                  <button className="button secondary" formAction={runManualSync} name="source" value={config.source}>
                    Run now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </form>

      <h2>Recent sync runs</h2>
      <table className="table">
        <thead>
          <tr><th>Started</th><th>Source</th><th>Status</th><th>Seen</th><th>Stored</th><th>Error</th></tr>
        </thead>
        <tbody>
          {data.recentRuns.map((run) => (
            <tr key={run.id}>
              <td>{run.startedAt}</td>
              <td>{sourceLabels[run.source]}</td>
              <td>{run.status}</td>
              <td>{run.recordsSeen}</td>
              <td>{run.recordsUpserted}</td>
              <td>{run.errorMessage ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
