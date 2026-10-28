import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { NotificationsProvider } from "./components/notifications";
import { applyCachedAppearance } from "./lib/appearance";
import "./styles/index.css";

applyCachedAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NotificationsProvider>
      <App />
    </NotificationsProvider>
  </StrictMode>,
);
