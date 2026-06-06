export const dynamic = "force-dynamic";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function authHeader(): string {
  const user = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "change-me";
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

export async function apiGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { Authorization: authHeader() },
      cache: "no-store"
    });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function apiPatch(path: string, body: unknown): Promise<void> {
  await fetch(`${apiBaseUrl}${path}`, {
    method: "PATCH",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function apiPost(path: string, body: unknown): Promise<void> {
  await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
