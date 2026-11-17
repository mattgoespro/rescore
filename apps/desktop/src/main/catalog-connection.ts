export interface ServiceConnection {
  port: number;
  token: string;
  catalogId: string;
  runtimeVersion: string;
}

let service: ServiceConnection | null = null;
let blocked = false;
let openWaiters: Array<() => void> = [];
let resumes = 0;

export function setServiceConnection(next: ServiceConnection | null): void {
  service = next;
}
export function serviceConnection(): ServiceConnection | null {
  return service;
}
export function blockCatalogConnection(value: boolean): void {
  blocked = value;
  if (blocked) return;
  const open = openWaiters;
  openWaiters = [];
  for (const release of open) release();
}

/**
 * Resolves once catalogue data is not being transferred. Catalogue calls wait
 * here before they start, so maintenance holds them instead of failing them.
 */
export function whenCatalogConnectionOpen(): Promise<void> {
  if (!blocked) return Promise.resolve();
  return new Promise((resolve) => openWaiters.push(resolve));
}

/** Counts wakes from sleep, which a request in flight could not see. */
export function noteSystemResume(): void {
  resumes++;
}
export function systemResumes(): number {
  return resumes;
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
