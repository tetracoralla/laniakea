import { describe, expect, it } from "vitest";
import script from "../../script/build_and_run.sh?raw";
import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("desktop build-and-run entrypoint", () => {
  it("launches and verifies the app bundle instead of the raw Cargo binary", () => {
    const cleanupIndex = script.indexOf('rm -rf -- "$APP_BUNDLE"');
    const buildIndex = script.indexOf("npx tauri build --bundles app");

    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(buildIndex);
    expect(script).toContain('/usr/bin/open "$APP_BUNDLE"');
    expect(script).not.toContain('/usr/bin/open -a "$APP_BUNDLE"');
    expect(script).not.toContain('/usr/bin/open -n "$APP_BUNDLE"');
    expect(script).toContain("for attempt in 1 2 3 4 5");
    expect(script).toContain('pgrep -f "$APP_BINARY"');
    expect(script).not.toMatch(
      /(?:nohup|open)\s+["']?\$?RELEASE_BINARY/,
    );
    expect(script).not.toContain('kill -0 "$LAUNCH_PID"');
  });

  it("ad-hoc signs local macOS bundles so LaunchServices can open them", () => {
    expect(tauriConfig.bundle.macOS.signingIdentity).toBe("-");
  });
});
