const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function authHeader(): string {
  const user = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "change-me";
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

export async function GET() {
  const response = await fetch(`${apiBaseUrl}/exports/raw-observations.csv`, {
    headers: { Authorization: authHeader() },
    cache: "no-store"
  });

  if (!response.ok) {
    return new Response("CSV export failed", { status: 502 });
  }

  return new Response(await response.text(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": response.headers.get("Content-Disposition") ?? 'attachment; filename="raw-flight-observations.csv"'
    }
  });
}
