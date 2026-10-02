export interface ServiceConnection {
  port: number;
  token: string;
  catalogId: string;
  runtimeVersion: string;
}

let service: ServiceConnection | null = null;
let blocked = false;

export function setServiceConnection(next: ServiceConnection | null): void {
  service = next;
}
export function serviceConnection(): ServiceConnection | null {
  return service;
}
export function blockCatalogConnection(value: boolean): void {
  blocked = value;
}
export function effectiveCatalogUrl(configured: string): string {
  return service ? `http://127.0.0.1:${service.port}` : configured;
}

export function catalogFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  if (blocked)
    return Promise.reject(
      new Error("Catalogue data is being transferred. Please wait."),
    );
  const url = new URL(input);
  const headers = new Headers(init?.headers);
  if (service && url.origin === `http://127.0.0.1:${service.port}`) {
    headers.set("Authorization", `Bearer ${service.token}`);
  }
  return fetch(url, { ...init, headers, redirect: "error" });
}

export function matchesServiceHealth(
  health: unknown,
  expected: ServiceConnection,
): boolean {
  const value = health as Record<string, unknown> | null;
  return (
    value?.runtimeMode === "service" &&
    value.protocolVersion === 1 &&
    value.catalogId === expected.catalogId &&
    value.runtimeVersion === expected.runtimeVersion
  );
}
