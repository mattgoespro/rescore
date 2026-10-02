import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface ServiceConfig {
  protocolVersion: 1;
  catalogId: string;
  runtimeVersion: string;
  token: string;
  port: number;
  dataDir: string;
  region?: string;
}

export function parseServiceConfig(raw: unknown): ServiceConfig {
  const value = raw as ServiceConfig;
  if (
    !value ||
    value.protocolVersion !== 1 ||
    !/^[a-f0-9-]{36}$/.test(value.catalogId) ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535 ||
    typeof value.runtimeVersion !== "string" ||
    typeof value.dataDir !== "string" ||
    !isAbsolute(value.dataDir) ||
    (value.region !== undefined && !/^[A-Z]{2}$/.test(value.region))
  ) {
    throw new Error("Invalid catalogue service configuration");
  }
  return value;
}

export const serviceConfig = process.env.RESCORE_SERVICE_CONFIG
  ? parseServiceConfig(
      JSON.parse(readFileSync(process.env.RESCORE_SERVICE_CONFIG, "utf8")),
    )
  : null;

if (serviceConfig) {
  process.env.PORT = String(serviceConfig.port);
  process.env.IMDB_DATA_DIR = serviceConfig.dataDir;
  process.env.CATALOG_DB_PATH = join(serviceConfig.dataDir, "catalog.sqlite");
  process.env.POSTER_CACHE_DIR = join(serviceConfig.dataDir, "posters");
  process.env.RESCORE_CONTROL_TOKEN = serviceConfig.token;
  process.env.CATALOG_REGION = serviceConfig.region ?? "US";
  delete process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_KEYS;
}
