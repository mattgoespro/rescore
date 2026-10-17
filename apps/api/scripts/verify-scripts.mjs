// Exercise tooling and compiled lifecycle entry points against temporary data
// and loopback IMDb/TMDb substitutes; never use the installed catalogue or keys.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "rescore-api-scripts-"));
const data = join(directory, "data");
const dbPath = join(data, "catalog.sqlite");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run with npm run test:scripts --workspace=@rescore/api");
const files = {
  "title.ratings.tsv.gz":
    "tconst\taverageRating\tnumVotes\ntt0000001\t8.2\t2000\n",
  "title.basics.tsv.gz":
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\ntt0000001\tmovie\tScript Fixture\tScript Fixture\t0\t2000\t\\N\t95\tDrama\n",
  "title.crew.tsv.gz":
    "tconst\tdirectors\twriters\ntt0000001\tnm0000001\t\\N\n",
  "title.principals.tsv.gz":
    "tconst\tordering\tnconst\tcategory\tjob\tcharacters\ntt0000001\t1\tnm0000001\tactor\t\\N\t[]\n",
  "name.basics.tsv.gz":
    "nconst\tprimaryName\tbirthYear\tdeathYear\tprimaryProfession\tknownForTitles\nnm0000001\tScript Person\t1970\t\\N\tactor\ttt0000001\n",
};
let metadataRequests = 0;
let stopRequests = 0;
const token = randomBytes(32).toString("hex");
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://fixture");
  if (url.pathname === "/internal/shutdown") {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    stopRequests++;
    response.end("{}");
  } else if (url.pathname.startsWith("/tmdb/")) {
    assert.ok(
      ["fixture-a", "fixture-b"].includes(url.searchParams.get("api_key")),
    );
    metadataRequests++;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ movie_results: [], tv_results: [] }));
  } else if (files[url.pathname.slice(1)]) {
    const body = gzipSync(
      files[url.pathname.slice(1)] +
        "#padding-for-gzip-minimum-size-012345678901234567890123456789\n",
    );
    response.setHeader("etag", '"script-fixture"');
    response.setHeader("content-length", body.length);
    response.end(request.method === "HEAD" ? undefined : body);
  } else {
    response.writeHead(404);
    response.end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const env = {
  ...process.env,
  IMDB_DATA_DIR: data,
  CATALOG_DB_PATH: dbPath,
  IMDB_DATASETS_BASE: origin,
  IMDB_RATINGS_URL: `${origin}/title.ratings.tsv.gz`,
  TMDB_API_BASE: `${origin}/tmdb`,
  TMDB_IMAGE_BASE: `${origin}/images`,
  TMDB_API_KEYS: "fixture-a\nfixture-b",
  TMDB_API_KEY: "",
  TMDB_SMOKE_SAMPLES_PER_CAP: "20",
};
delete env.RESCORE_SERVICE_CONFIG;
delete env.TMDB_SMOKE_CONFIRM;

async function run(name, args, overrides = {}, expectedCode = 0) {
  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    env: { ...env, ...overrides },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    errors = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const timer = setTimeout(() => child.kill(), 60000);
  try {
    const [code] = await once(child, "exit");
    writeFileSync(join(directory, name + ".log"), output + errors);
    if (expectedCode === 0) assert.equal(code, 0, output + errors);
    else
      assert.notEqual(
        code,
        0,
        "Expected the live-request confirmation guard to reject execution",
      );
    return output + errors;
  } finally {
    clearTimeout(timer);
  }
}
const cli = (name, extra = [], overrides = {}, expectedCode = 0) =>
  run(name, [npmCli, "run", name, "--", ...extra], overrides, expectedCode);
function inspect(path, check) {
  const db = new Database(path, { readonly: true });
  try {
    check(db);
  } finally {
    db.close();
  }
}
try {
  const oldOutput = join(appRoot, "dist", "scripts");
  mkdirSync(oldOutput, { recursive: true });
  writeFileSync(
    join(oldOutput, "stale-development.js"),
    "// obsolete generated tooling",
  );
  await cli("build");
  assert.equal(existsSync(oldOutput), false);
  assert.ok(existsSync(join(appRoot, "dist", "index.js")));
  for (const entry of ["service-data", "service-stop"])
    assert.ok(existsSync(join(appRoot, "dist", "lifecycle", entry + ".js")));
  console.log(
    "PASS clean API build excludes tooling and emits lifecycle entry points",
  );
  assert.match(await cli("smoke:tmdb", [], {}, 1), /TMDB_SMOKE_CONFIRM=1/);
  assert.equal(metadataRequests, 0);
  console.log(
    "PASS throughput smoke retains its live-request confirmation guard",
  );
  await cli("migrate");
  assert.ok(existsSync(dbPath));
  console.log("PASS migrate command creates a temporary catalogue");
  assert.match(await cli("build:catalog", ["--force"]), /Built 1 titles/);
  inspect(dbPath, (db) => {
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM titles").get().count,
      1,
    );
    assert.ok(
      db.prepare("SELECT count(*) AS count FROM title_people").get().count > 0,
    );
  });
  console.log("PASS catalogue CLI downloads and imports local IMDb fixtures");
  assert.match(await cli("enrich:posters"), /0 errors/);
  assert.ok(metadataRequests > 0);
  console.log("PASS poster enrichment CLI calls local TMDb fixtures");
  const smoke = await cli("smoke:tmdb", [], { TMDB_SMOKE_CONFIRM: "1" });
  const report = JSON.parse(smoke.slice(smoke.indexOf("{")));
  assert.equal(report.multiKeyRuns.length, 3);
  assert.equal(report.singleKeyCaps.length, 2);
  console.log(
    "PASS throughput smoke completes both fixture key lanes and all three caps",
  );
  const configPath = join(directory, "service.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      protocolVersion: 1,
      catalogId: randomUUID(),
      runtimeVersion: "fixture",
      token,
      port: server.address().port,
      dataDir: data,
    }),
  );
  await run(
    "service-stop",
    [join(appRoot, "dist", "lifecycle", "service-stop.js")],
    { RESCORE_SERVICE_CONFIG: configPath },
  );
  assert.equal(stopRequests, 1);
  console.log("PASS compiled lifecycle shutdown authenticates its request");
  const target = join(directory, "copied");
  await run("service-data", [
    join(appRoot, "dist", "lifecycle", "service-data.js"),
    data,
    target,
  ]);
  inspect(join(target, "catalog.sqlite"), (db) => {
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM titles").get().count,
      1,
    );
  });
  console.log(
    "PASS compiled lifecycle data handoff preserves the fixture catalogue",
  );
  console.log("Evidence: " + directory);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
