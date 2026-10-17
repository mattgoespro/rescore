const { existsSync, readFileSync } = require("node:fs");
const { join, posix, sep } = require("node:path");
const { extractFile } = require("@electron/asar");

function checkPackage(folder) {
  const archive = join(folder, "resources", "app.asar");
  const read = (path) => extractFile(archive, path.split(/[\\/]/).join(sep));
  const metadata = JSON.parse(read("package.json").toString("utf8"));
  if (metadata.name !== "rescore" || metadata.main !== "./out/main/index.js") {
    throw new Error("Packaged application identity or main entry is incorrect.");
  }
  for (const path of ["out/main/index.js", "out/preload/index.js", "out/renderer/index.html"]) {
    if (!read(path).length) throw new Error(`Packaged application file is empty: ${path}`);
  }
  const html = read("out/renderer/index.html").toString("utf8");
  for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)) {
    read(posix.join("out/renderer", match[1]));
  }
  for (const path of [
    "Rescore.exe", "Rescore Logs.exe",
    "resources/service/Rescore Maintenance.exe",
    "resources/service/maintenance.ps1", "resources/service/manage-service.ps1",
    "resources/api/node.exe", "resources/api/RescoreService.exe",
    "resources/api/dist/index.js", "resources/api/service-manifest.json",
    "resources/api/dist/lifecycle/service-data.js", "resources/api/dist/lifecycle/service-stop.js",
  ]) {
    if (!existsSync(join(folder, path))) throw new Error(`Packaged lifecycle file is missing: ${path}`);
  }
  if (existsSync(join(folder, "resources/api/dist/scripts"))) {
    throw new Error("Legacy scripts output must not be included in the packaged API.");
  }
  const helper = readFileSync(join(folder, "resources/service/Rescore Maintenance.exe"));
  const pe = helper.readUInt32LE(60);
  if (helper.readUInt16LE(pe + 4) !== 0x8664 || helper.readUInt16LE(pe + 24 + 68) !== 2) {
    throw new Error("Maintenance helper must be an x64 Windows GUI executable.");
  }
}

module.exports = { checkPackage };
if (require.main === module) {
  checkPackage(process.argv[2] ?? join(__dirname, "../../../dist/win-unpacked"));
  console.log("PASS: packaged Rescore identity, renderer assets, preload, API, and windowless lifecycle helper.");
}
