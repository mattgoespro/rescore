import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createCatalogLifecycle } from "../src/main/catalog-lifecycle.ts";
import {
  catalogFetch,
  matchesServiceHealth,
  setServiceConnection,
} from "../src/main/catalog-connection.ts";

const directory =
  process.argv[2] ?? mkdtempSync(join(tmpdir(), "rescore-recovery-"));
mkdirSync(directory, { recursive: true });
let online = false,
  correctIdentity = true,
  reads = 0,
  maintenance = 0;
const config = {
  port: 0,
  token: randomBytes(32).toString("hex"),
  catalogId: randomUUID(),
  runtimeVersion: "fixture",
};
const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${config.token}`) {
    response.writeHead(401);
    response.end();
    return;
  }
  reads++;
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify(
      online
        ? {
            runtimeMode: "service",
            protocolVersion: 1,
            catalogId: correctIdentity ? config.catalogId : "wrong",
            runtimeVersion: config.runtimeVersion,
            ready: true,
            catalogPhase: "ready",
            catalogUsable: true,
            titleCount: 2,
            creditsReady: true,
            titlesReady: true,
          }
        : {},
    ),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
config.port = server.address().port;
setServiceConnection(config);
const baseUrl = `http://127.0.0.1:${config.port}`;
const service = () => ({
  supported: true,
  enabled: true,
  state: online ? "running" : "stopped",
  message: "fixture",
});
const runtime = createCatalogLifecycle(
  {
    serviceOwned: () => true,
    inspect: async (intent) => ({
      status: service(),
      activity: "idle",
      action: intent === "launch" && !online ? "EnsureRunning" : "none",
    }),
    maintain: async () => {
      maintenance++;
      return service();
    },
    block: () => {},
    probe: async (signal) => {
      const response = await catalogFetch(new URL("/health", baseUrl), {
        signal,
      });
      const data = await response.json();
      return {
        health: matchesServiceHealth(data, config)
          ? {
              phase: "ready",
              message: "ready",
              titleCount: 2,
              builtAt: null,
              error: null,
              download: null,
              titlesReady: true,
              creditsReady: true,
              titlesUpdateAvailable: false,
              creditsFailed: false,
              catalogUsable: true,
            }
          : null,
        portOpen: true,
        childAlive: false,
      };
    },
    spawn: async () => {
      throw new Error("Windows-owned catalogue must never spawn a replacement");
    },
    killOwned: async () => {},
    stopOwned: async () => {},
    rebuild: async () => {},
    subscribeHydration: () => () => {},
    publish: () => {},
  },
  { timings: { watch: 15, poll: 5, start: 50, stop: 100 } },
);
async function until(condition) {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error(
        `Fixture deadline; state ${JSON.stringify(runtime.state())}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
try {
  runtime.start();
  await until(() => runtime.status().phase === "error");
  assert.equal(maintenance, 1);
  online = true;
  await until(() => runtime.status().phase === "ready");
  online = false;
  await until(() => runtime.status().phase === "error");
  const before = reads;
  online = true;
  await until(() => runtime.status().phase === "ready" && reads >= before + 3);
  assert.equal(
    maintenance,
    1,
    "Passive recovery must not launch more maintenance",
  );
  correctIdentity = false;
  await until(() => runtime.status().phase === "error");
  correctIdentity = true;
  await until(() => runtime.status().phase === "ready");
  const evidence = {
    authenticatedHealthReads: reads,
    maintenanceAttempts: maintenance,
    phaseAfterRecovery: runtime.status().phase,
  };
  writeFileSync(
    join(directory, "runtime.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "PASS initial recovery, later recovery, authenticated identity validation, and one preparation attempt",
  );
} finally {
  await runtime.stop();
  setServiceConnection(null);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
