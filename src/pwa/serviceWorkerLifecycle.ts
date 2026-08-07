const desktopCachePrefix = "laniakea-";
const desktopReloadGuardKey =
  "laniakea:desktop-service-worker-retirement-reload";

interface ServiceWorkerRegistrationLike {
  unregister: () => Promise<boolean>;
}

interface ServiceWorkerContainerLike {
  controller: unknown | null;
  getRegistrations: () => Promise<readonly ServiceWorkerRegistrationLike[]>;
}

interface CacheStorageLike {
  delete: (cacheName: string) => Promise<boolean>;
  keys: () => Promise<string[]>;
}

interface SessionStorageLike {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

interface DesktopServiceWorkerRetirementOptions {
  cacheStorage?: CacheStorageLike;
  reload: () => void;
  serviceWorker: ServiceWorkerContainerLike;
  sessionStorage?: SessionStorageLike;
}

function readReloadGuard(storage?: SessionStorageLike): boolean {
  try {
    return storage?.getItem(desktopReloadGuardKey) === "true";
  } catch {
    return false;
  }
}

function setReloadGuard(storage?: SessionStorageLike): void {
  try {
    storage?.setItem(desktopReloadGuardKey, "true");
  } catch {
    // A successful unregister normally makes the next document uncontrolled.
  }
}

function clearReloadGuard(storage?: SessionStorageLike): void {
  try {
    storage?.removeItem(desktopReloadGuardKey);
  } catch {
    // The guard is only protection against an abnormal repeated reload.
  }
}

export async function retireDesktopServiceWorkers({
  cacheStorage,
  reload,
  serviceWorker,
  sessionStorage,
}: DesktopServiceWorkerRetirementOptions): Promise<boolean> {
  let registrations: readonly ServiceWorkerRegistrationLike[] = [];
  try {
    registrations = await serviceWorker.getRegistrations();
  } catch {
    // Cache cleanup and the controller check can still make progress.
  }

  await Promise.allSettled(
    registrations.map((registration) => registration.unregister()),
  );

  if (cacheStorage) {
    try {
      const cacheNames = await cacheStorage.keys();
      await Promise.allSettled(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(desktopCachePrefix))
          .map((cacheName) => cacheStorage.delete(cacheName)),
      );
    } catch {
      // An unregistered worker can no longer serve any cache left behind.
    }
  }

  if (serviceWorker.controller === null) {
    clearReloadGuard(sessionStorage);
    return false;
  }

  if (readReloadGuard(sessionStorage)) return false;
  setReloadGuard(sessionStorage);
  reload();
  return true;
}
