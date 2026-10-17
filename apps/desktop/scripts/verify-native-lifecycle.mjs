import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const directory = mkdtempSync(join(tmpdir(), "rescore-native-lifecycle-"));
const root = fileURLToPath(new URL("../src/main/", import.meta.url)).replaceAll(
  "\\",
  "/",
);
const entry = join(directory, "entry.ts");
const bundle = join(directory, "runtime.cjs");
writeFileSync(
  entry,
  `export {createCatalogRuntime} from ${JSON.stringify(root + "catalog-runtime.ts")};\nexport {setServiceConnection} from ${JSON.stringify(root + "catalog-connection.ts")};`,
);
await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
let online = true,
  requests = 0,
  rebuilds = 0,
  activeStreams = 0,
  streams = 0;
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
  if (request.url === "/v1/catalog/hydration/events") {
    activeStreams++;
    streams++;
    response.once("close", () => {
      activeStreams--;
    });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `event: hydration\ndata: ${JSON.stringify({ processed: 1, total: 2, percent: 50, complete: false, message: "fixture metadata" })}\n\n`,
    );
    return;
  }
  if (request.url === "/v1/catalog/rebuild") {
    assert.equal(request.method, "POST");
    rebuilds++;
    response.writeHead(409, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Already building" }));
    return;
  }
  requests++;
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify(
      online
        ? {
            runtimeMode: "service",
            protocolVersion: 1,
            catalogId: config.catalogId,
            runtimeVersion: config.runtimeVersion,
            ready: true,
            catalogPhase: "ready",
            catalogUsable: true,
            titleCount: 2,
            creditsReady: true,
            titlesReady: true,
          }
        : null,
    ),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
config.port = server.address().port;
const main = join(directory, "main.cjs");
writeFileSync(
  main,
  `
const {app}=require('electron');
app.setPath('userData',${JSON.stringify(join(directory, "user-data"))});
Object.defineProperty(app,'isPackaged',{value:true});
const {createCatalogRuntime,setServiceConnection}=require(${JSON.stringify(bundle)});
const config=${JSON.stringify(config)};setServiceConnection(config);
const service={inspect:async()=>({status:{supported:true,enabled:true,state:'running',message:'fixture'},activity:'idle',action:'none'}),maintain:async()=>{throw new Error('Fixture must never perform Windows maintenance');}};
let runtime;
const until=async(condition)=>{const end=Date.now()+15000;while(!condition()){if(Date.now()>end)throw new Error('Native fixture deadline: '+JSON.stringify(runtime.status()));await new Promise(resolve=>setTimeout(resolve,20));}};
app.whenReady().then(async()=>{
 runtime=createCatalogRuntime({getSettings:()=>({catalogApiUrl:'http://127.0.0.1:'+config.port})},()=>null,service);
 runtime.start();await until(()=>runtime.status().phase==='ready');
 await until(()=>runtime.status().tmdbHydration?.processed===1);
 if(runtime.rebuild().phase!=='building')throw new Error('Rebuild did not publish building');
 await until(()=>runtime.status().phase==='ready');
 console.log('FIXTURE_OFFLINE');await until(()=>runtime.status().phase==='error');
 console.log('FIXTURE_ONLINE');await until(()=>runtime.status().phase==='ready');
 await runtime.stop();console.log('PASS native Electron adapter recovered and stopped');app.quit();
}).catch(async error=>{console.error(error);if(runtime)await runtime.stop();app.exit(1);});
`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [main], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (data) => {
  const text = String(data);
  output += text;
  if (text.includes("FIXTURE_OFFLINE")) online = false;
  if (text.includes("FIXTURE_ONLINE")) online = true;
});
child.stderr.on("data", (data) => {
  output += String(data);
});
const timeout = setTimeout(() => child.kill(), 40000);
try {
  const [code] = await new Promise((resolve, reject) => {
    child.once("exit", (...args) => resolve(args));
    child.once("error", reject);
  });
  assert.equal(code, 0, output);
  assert.match(output, /PASS native Electron/);
  assert.equal(rebuilds, 1);
  assert.ok(streams > 0, "Hydration stream was never opened");
  const streamDeadline = Date.now() + 1000;
  while (activeStreams && Date.now() < streamDeadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    activeStreams,
    0,
    "Hydration stream remained open after shutdown",
  );
  writeFileSync(
    join(directory, "evidence.json"),
    JSON.stringify(
      { requests, rebuilds, streams, activeStreams, output },
      null,
      2,
    ),
  );
  console.log(
    "PASS native Electron lifecycle adapter: authenticated health, rebuild 409, outage/recovery, stream cleanup, and shutdown",
  );
  console.log("Evidence: " + directory);
} finally {
  clearTimeout(timeout);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
