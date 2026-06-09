import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? next : "true";
    if (args[key] === next) index += 1;
  }
  return args;
}

async function loadEnv() {
  const envPath = resolve(".env");
  try {
    const text = await readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"|"$/g, "");
      if (process.env[key] == null) process.env[key] = value;
    }
  } catch {
    // The caller may have provided environment variables directly.
  }
}

await loadEnv();

if (process.env.APP_ENVIRONMENT === "PROD") {
  throw new Error("This manual Google Flights test is DEV-only and refuses to run with APP_ENVIRONMENT=PROD.");
}

const args = parseArgs(process.argv.slice(2));
const from = args.from;
const to = args.to;
const date = args.date;

if (!from || !to || !date) {
  throw new Error("Usage: pnpm debug:google-flights --from FRA --to ADD --date 2026-06-09 [--flight ET707]");
}

const apiKey = process.env.GOOGLE_FLIGHTS_RAPIDAPI_KEY ?? process.env.RAPIDAPI_KEY;
if (!apiKey) {
  throw new Error("GOOGLE_FLIGHTS_RAPIDAPI_KEY or RAPIDAPI_KEY is not configured.");
}

const host = process.env.GOOGLE_FLIGHTS_RAPIDAPI_HOST ?? "google-flights4.p.rapidapi.com";
const endpoint = process.env.GOOGLE_FLIGHTS_SEARCH_ONE_WAY_ENDPOINT ?? "/flights/search-one-way";
const url = new URL(`https://${host}${endpoint}`);
const params = {
  departure_id: from,
  arrival_id: to,
  outbound_date: date,
  adults: "1",
  currency: process.env.GOOGLE_FLIGHTS_CURRENCY ?? "USD",
  language_code: process.env.GOOGLE_FLIGHTS_LANGUAGE_CODE ?? "en",
  country_code: process.env.GOOGLE_FLIGHTS_COUNTRY_CODE ?? "US",
  flight_number: args.flight ?? null
};

for (const [key, value] of Object.entries(params)) {
  if (value != null && value !== "") url.searchParams.set(key, String(value));
}

console.log(`GET ${url.toString().replace(apiKey, "***")}`);

const response = await fetch(url, {
  headers: {
    "Content-Type": "application/json",
    "x-rapidapi-host": host,
    "x-rapidapi-key": apiKey
  }
});

const bodyText = await response.text();
const output = {
  status: response.status,
  statusText: response.statusText,
  request: { host, endpoint, params },
  body: bodyText.trim() ? JSON.parse(bodyText) : null
};

const outputPath = resolve("tmp-google-flights-manual-test.json");
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`HTTP ${response.status} ${response.statusText}`);
console.log(`Wrote ${outputPath}`);
