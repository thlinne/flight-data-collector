const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function authHeader(): string {
  const user = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "change-me";
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = await fetch(`${apiBaseUrl}/reports/r1.pdf?${url.searchParams.toString()}`, {
    headers: { Authorization: authHeader() },
    cache: "no-store"
  });

  if (!response.ok || !response.body) {
    return new Response("PDF report export failed", { status: 502 });
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/pdf",
      "Content-Disposition": response.headers.get("Content-Disposition") ?? 'attachment; filename="r1-one-day-overview.pdf"'
    }
  });
}
