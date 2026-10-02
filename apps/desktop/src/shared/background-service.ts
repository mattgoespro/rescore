export interface BackgroundServiceStatus {
  supported: boolean;
  enabled: boolean;
  state: "not-installed" | "stopped" | "running" | "transitioning" | "error";
  message: string;
  runtimeVersion?: string;
  logsAvailable?: boolean;
}
