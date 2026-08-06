import { describe, expect, it } from "vitest";
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
});
