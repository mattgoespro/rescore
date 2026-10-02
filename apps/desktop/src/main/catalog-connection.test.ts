import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, test } from "node:test";
import {
  blockCatalogConnection,
  catalogFetch,
  effectiveCatalogUrl,
  matchesServiceHealth,
  serviceConnection,
  setServiceConnection,
  type ServiceConnection,
} from "./catalog-connection.js";

const connection: ServiceConnection = {
  port: 3848,
  token: "test-only-service-secret",
  catalogId: "test-catalogue",
  runtimeVersion: "1.0.0",
};

afterEach(() => {
  setServiceConnection(null);
  blockCatalogConnection(false);
});

test("service endpoint overrides configuration only while enabled", () => {
  const configured = "https://catalogue.example.test";
  assert.equal(effectiveCatalogUrl(configured), configured);
  setServiceConnection(connection);
  assert.equal(effectiveCatalogUrl(configured), "http://127.0.0.1:3848");
  assert.equal(serviceConnection()?.catalogId, connection.catalogId);
  setServiceConnection(null);
  assert.equal(effectiveCatalogUrl(configured), configured);
});

test("authentication attaches only to exact service origin", async (t) => {
  setServiceConnection(connection);
  const calls: {
    authenticated: boolean;
    authorizationPresent: boolean;
    redirect: RequestRedirect | undefined;
  }[] = [];
  t.mock.method(globalThis, "fetch", async (_input: URL, init: RequestInit) => {
    const authorization = new Headers(init.headers).get("Authorization");
    calls.push({
      authenticated: authorization === `Bearer ${connection.token}`,
      authorizationPresent: authorization !== null,
      redirect: init.redirect,
    });
    return new Response("ok");
  });
  await catalogFetch("http://127.0.0.1:3848/catalog");
  for (const url of [
    "http://127.0.0.1:3849/catalog",
    "http://localhost:3848/catalog",
    "https://127.0.0.1:3848/catalog",
    "http://127.0.0.1.example.test:3848/catalog",
  ])
    await catalogFetch(url);
  assert.equal(calls[0].authenticated, true);
  assert.equal(
    calls.slice(1).some((call) => call.authorizationPresent),
    false,
  );
  assert.ok(calls.every((call) => call.redirect === "error"));
});

test("transfer blocks network requests", async (t) => {
  let fetched = false;
  t.mock.method(globalThis, "fetch", async () => {
    fetched = true;
    return new Response("ok");
  });
  blockCatalogConnection(true);
  await assert.rejects(
    catalogFetch("http://127.0.0.1:3848/catalog"),
    /being transferred/,
  );
  assert.equal(fetched, false);
  blockCatalogConnection(false);
  await catalogFetch("http://127.0.0.1:3848/catalog");
  assert.equal(fetched, true);
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

test("redirect rejection prevents service credentials reaching another server", async () => {
  let targetRequests = 0;
  let sourceAuthenticated = false;
  const target = createServer((_req, res) => {
    targetRequests += 1;
    res.end("unexpected");
  });
  const targetPort = await listen(target);
  const source = createServer((req, res) => {
    sourceAuthenticated =
      req.headers.authorization === `Bearer ${connection.token}`;
    res.writeHead(302, {
      Location: `http://127.0.0.1:${targetPort}/redirect-target`,
    });
    res.end();
  });
  try {
    const sourcePort = await listen(source);
    setServiceConnection({ ...connection, port: sourcePort });
    await assert.rejects(
      catalogFetch(`http://127.0.0.1:${sourcePort}/catalog`),
    );
    assert.equal(sourceAuthenticated, true);
    assert.equal(targetRequests, 0);
  } finally {
    await Promise.all([close(source), close(target)]);
  }
});

test("service health requires matching catalogue, protocol, version and mode", () => {
  const health = {
    runtimeMode: "service",
    protocolVersion: 1,
    catalogId: connection.catalogId,
    runtimeVersion: connection.runtimeVersion,
  };
  assert.equal(matchesServiceHealth(health, connection), true);
  for (const invalid of [
    null,
    undefined,
    {},
    "healthy",
    { ...health, catalogId: "another-catalogue" },
    { ...health, protocolVersion: 2 },
    { ...health, runtimeVersion: "0.9.0" },
    { ...health, runtimeMode: "desktop" },
  ])
    assert.equal(matchesServiceHealth(invalid, connection), false);
});
