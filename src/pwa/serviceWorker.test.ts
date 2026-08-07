import { describe, expect, it, vi } from "vitest";
import mainSource from "../main.tsx?raw";
import { retireDesktopServiceWorkers } from "./serviceWorkerLifecycle";
import serviceWorker from "../../public/sw.js?raw";

describe("PWA application shell", () => {
  it("ignores Vary when serving same-origin cached modules offline", () => {
    expect(serviceWorker).toContain(
      "caches.match(event.request, { ignoreVary: true })",
    );
    expect(serviceWorker).toContain(
      "caches.match(SCOPE_URL, { ignoreVary: true })",
    );
  });

  it("never substitutes HTML for a missing JavaScript or CSS request", () => {
    const assetBranch = serviceWorker.slice(
      serviceWorker.indexOf("caches.match(event.request"),
    );
    expect(assetBranch).not.toContain("caches.match(SCOPE_URL");
  });

  it("does not register a new PWA shell inside the desktop WebView", () => {
    expect(mainSource).toContain("desktopRuntime");
    expect(mainSource).toContain("retireDesktopServiceWorkers");
    expect(serviceWorker).toContain(
      "const IS_DESKTOP_RUNTIME = self.location.protocol === 'tauri:'",
    );
    expect(serviceWorker).toContain("self.registration.unregister()");
    expect(serviceWorker).toContain("if (IS_DESKTOP_RUNTIME) return");
  });

  it("retires an installed desktop worker and its caches before reloading", async () => {
    const order: string[] = [];
    const storage = new Map<string, string>();
    const reloaded = await retireDesktopServiceWorkers({
      cacheStorage: {
        keys: async () => {
          order.push("cache-keys");
          return ["laniakea-v3", "other-app", "laniakea-v4"];
        },
        delete: async (cacheName) => {
          order.push(`delete:${cacheName}`);
          return true;
        },
      },
      reload: () => order.push("reload"),
      serviceWorker: {
        controller: { scriptURL: "tauri://localhost/sw.js" },
        getRegistrations: async () => {
          order.push("registrations");
          return [
            {
              unregister: async () => {
                order.push("unregister:v3");
                return true;
              },
            },
          ];
        },
      },
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        removeItem: (key) => storage.delete(key),
        setItem: (key, value) => storage.set(key, value),
      },
    });

    expect(reloaded).toBe(true);
    expect(order).toEqual([
      "registrations",
      "unregister:v3",
      "cache-keys",
      "delete:laniakea-v3",
      "delete:laniakea-v4",
      "reload",
    ]);
    expect(order).not.toContain("delete:other-app");
  });

  it("guards against reload loops while an old controller is releasing", async () => {
    const storage = new Map<string, string>();
    const reload = vi.fn();
    const serviceWorker: {
      controller: unknown | null;
      getRegistrations: () => Promise<[]>;
    } = {
      controller: {},
      getRegistrations: async () => [],
    };
    const options = {
      reload,
      serviceWorker,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    };

    expect(await retireDesktopServiceWorkers(options)).toBe(true);
    expect(await retireDesktopServiceWorkers(options)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();

    serviceWorker.controller = null;
    expect(await retireDesktopServiceWorkers(options)).toBe(false);
    serviceWorker.controller = {};
    expect(await retireDesktopServiceWorkers(options)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
