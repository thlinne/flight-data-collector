import { NextResponse } from "next/server";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function authHeader(): string {
  const user = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "change-me";
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

export async function GET() {
  const response = await fetch(`${apiBaseUrl}/admin/database-backup.sql`, {
    headers: { Authorization: authHeader() },
    cache: "no-store"
  });

  if (!response.ok || !response.body) {
    return NextResponse.json({ error: "Database backup failed" }, { status: 502 });
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/sql; charset=utf-8",
      "Content-Disposition": response.headers.get("content-disposition") ?? 'attachment; filename="flight_data_collector.sql"'
    }
  });
}
