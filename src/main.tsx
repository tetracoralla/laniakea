import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isDesktopRuntime } from "./persistence/localDocumentStore";
import { configureInternalDocumentRoot } from "./persistence/recentDocuments";
import { retireDesktopServiceWorkers } from "./pwa/serviceWorkerLifecycle";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/app.css";

function readableSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

async function startApplication() {
  const desktopRuntime = isDesktopRuntime();
  if (desktopRuntime) {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      configureInternalDocumentRoot(await appDataDir());
    } catch (error) {
      // Without a verified root, Save As preserves the source as a user file.
      console.warn("无法识别本地草稿目录", error);
    }
  }
  if ("serviceWorker" in navigator && desktopRuntime) {
    const reloadRequested = await retireDesktopServiceWorkers({
      cacheStorage: "caches" in window ? window.caches : undefined,
      reload: () => window.location.reload(),
      serviceWorker: navigator.serviceWorker,
      sessionStorage: readableSessionStorage(),
    });
    if (reloadRequested) return;
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  if (
    !("serviceWorker" in navigator) ||
    !import.meta.env.PROD ||
    desktopRuntime
  ) {
    return;
  }

  const registerServiceWorker = () => {
    void navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js`,
    );
  };
  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }
}

void startApplication();
