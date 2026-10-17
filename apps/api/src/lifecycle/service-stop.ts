import { serviceConfig } from "../services/service-environment.js";
if (!serviceConfig) throw new Error("Service configuration is required");
const response = await fetch(
  `http://127.0.0.1:${serviceConfig.port}/internal/shutdown`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceConfig.token}` },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  },
);
if (!response.ok) throw new Error(`Service stop failed (${response.status})`);
