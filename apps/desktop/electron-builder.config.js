const { execFileSync } = require("node:child_process");
const {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { delimiter, join } = require("node:path");

const BUNDLED_NODE_VERSION = "22.23.2";

/** @type {Promise<void> | null} */
let apiRuntimeStage = null;

/**
 * Compile the catalog API, bundle Node, and stage the runtime before pack.
 * @param {import('electron-builder').BeforePackContext} context
 */
async function stageApiRuntime(context) {
  if (context.electronPlatformName !== "win32") return;
  if (!apiRuntimeStage) {
    apiRuntimeStage = stageApiRuntimeToDisk(context.packager.projectDir);
  }
  await apiRuntimeStage;
}

/**
 * Copy the staged runtime into the unpacked app resources, outside asar.
 * @param {import('electron-builder').AfterPackContext} context
 */
function copyApiRuntime(context) {
  if (context.electronPlatformName !== "win32") return;

  const src = join(context.packager.projectDir, "build/api-runtime");
  const dest = join(context.appOutDir, "resources", "api");
  if (!existsSync(src)) {
    throw new Error(`API runtime missing at ${src}.`);
  }
  cpSync(src, dest, { recursive: true });
}

/**
 * @param {string} projectDir
 */
async function stageApiRuntimeToDisk(projectDir) {
  if (process.platform !== "win32") {
    throw new Error("The packaged API runtime is only staged for Windows.");
  }

  const repoRoot = join(projectDir, "../..");
  const apiRoot = join(repoRoot, "apps/api");
  const cacheDir = join(projectDir, "build/node");
  const stagingDir = join(projectDir, "build/api-runtime");
  const zipName = `node-v${BUNDLED_NODE_VERSION}-win-x64.zip`;
  const zipUrl = `https://nodejs.org/dist/v${BUNDLED_NODE_VERSION}/${zipName}`;
  const zipPath = join(cacheDir, zipName);
  const extractedDir = join(cacheDir, `node-v${BUNDLED_NODE_VERSION}-win-x64`);

  console.log("Compiling catalog API…");
  execFileSync(
    process.execPath,
    [
      join(repoRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.build.json",
      "--pretty",
      "false",
    ],
    { cwd: apiRoot, stdio: "inherit" },
  );

  const compiledEntry = join(apiRoot, "dist/index.js");
  if (!existsSync(compiledEntry)) {
    throw new Error(`API build did not produce ${compiledEntry}`);
  }

  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(join(extractedDir, "node.exe"))) {
    if (!existsSync(zipPath)) {
      console.log(`Downloading Node ${BUNDLED_NODE_VERSION}…`);
      await download(zipUrl, zipPath);
    }
    if (!isZip(zipPath)) {
      rmSync(zipPath, { force: true });
      throw new Error(`Downloaded Node archive is not a zip: ${zipPath}`);
    }
    console.log("Extracting bundled Node…");
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${cacheDir}' -Force`,
      ],
      { stdio: "inherit" },
    );
  }

  const bundledNode = join(extractedDir, "node.exe");
  const npmCli = join(extractedDir, "node_modules/npm/bin/npm-cli.js");
  if (!existsSync(bundledNode) || !existsSync(npmCli)) {
    throw new Error(`Bundled Node ${BUNDLED_NODE_VERSION} is incomplete.`);
  }

  console.log("Staging API runtime…");
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(join(stagingDir, "dist"), { recursive: true });

  const apiPackage = JSON.parse(
    readFileSync(join(apiRoot, "package.json"), "utf8"),
  );
  writeFileSync(
    join(stagingDir, "package.json"),
    `${JSON.stringify(
      {
        name: "rescore-api-runtime",
        private: true,
        type: "module",
        dependencies: apiPackage.dependencies,
      },
      null,
      2,
    )}\n`,
  );
  cpSync(join(apiRoot, "dist"), join(stagingDir, "dist"), { recursive: true });

  execFileSync(
    bundledNode,
    [npmCli, "install", "--omit=dev", "--omit=peer", "--no-audit", "--no-fund"],
    {
      cwd: stagingDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${extractedDir}${delimiter}${process.env.PATH ?? ""}`,
        npm_config_fund: "false",
      },
    },
  );
  copyFileSync(bundledNode, join(stagingDir, "node.exe"));

  const required = [
    join(stagingDir, "node.exe"),
    join(stagingDir, "dist/index.js"),
    join(stagingDir, "node_modules/better-sqlite3"),
  ];
  const missing = required.filter((file) => !existsSync(file));
  if (missing.length) {
    throw new Error(`API runtime staging incomplete: ${missing.join(", ")}`);
  }
  console.log(`API runtime staged at ${stagingDir}`);
}

/**
 * @param {string} url
 * @param {string} dest
 */
async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(
      `Downloaded Node archive is invalid (${bytes.length} bytes)`,
    );
  }
  writeFileSync(dest, bytes);
}

/**
 * @param {string} path
 */
function isZip(path) {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(2);
    readSync(fd, header, 0, 2, 0);
    return header[0] === 0x50 && header[1] === 0x4b;
  } finally {
    closeSync(fd);
  }
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.rescore.app",
  productName: "Rescore",
  icon: "../assets/icon.png",
  directories: {
    buildResources: "build",
  },
  files: [
    "!**/.vscode/*",
    "!src/*",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,CHANGELOG.md,README.md}",
    "!{.env,.env.*,.npmrc,package-lock.json}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
  ],
  asarUnpack: ["resources/**"],
  beforePack: stageApiRuntime,
  afterPack: copyApiRuntime,
  win: {
    executableName: "Rescore",
  },
  nsis: {
    artifactName: "${name}-${version}-setup.${ext}",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
    createDesktopShortcut: "always",
  },
  npmRebuild: false,
  electronVersion: "39.2.6",
};
