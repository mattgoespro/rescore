import type { RescoreAPI } from "./index";

declare global {
  interface Window {
    api: RescoreAPI;
  }
}

export {};
