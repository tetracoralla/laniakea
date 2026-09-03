import { describe, expect, it } from "vitest";
import script from "../../script/build_and_run.sh?raw";
import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("desktop build-and-run entrypoint", () => {
  it("launches and verifies the app bundle instead of the raw Cargo binary", () => {
    const defaultBranch = script.slice(script.indexOf('\npkill -f "${PROCESS_NAME}$"'));
    const cleanupIndex = defaultBranch.indexOf('rm -rf -- "$APP_BUNDLE"');
    const buildIndex = defaultBranch.indexOf("npx tauri build --bundles app");

    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(buildIndex);
    expect(script).toContain('open_app "$APP_BUNDLE"');
    expect(script).not.toContain('/usr/bin/open -a "$APP_BUNDLE"');
    expect(script).toContain("for attempt in 1 2 3 4 5");
    expect(script).not.toMatch(
      /(?:nohup|open)\s+["']?\$?RELEASE_BINARY/,
    );
    expect(script).not.toContain('kill -0 "$LAUNCH_PID"');
  });

  it("keeps desktop verification isolated from the owner's app", () => {
    const verifyBranch = script.slice(
      script.indexOf('if [[ "$MODE" == "--verify"'),
      script.indexOf('\nfi\n') + 4,
    );

    expect(verifyBranch).toContain('rm -rf -- "$VERIFY_APP_BUNDLE"');
    expect(verifyBranch).toContain(
      'npx tauri build --bundles app --config "$VERIFY_CONFIG"',
    );
    expect(verifyBranch).toContain('open_app "$VERIFY_APP_BUNDLE"');
    expect(verifyBranch).toContain('pgrep -f "$VERIFY_APP_BINARY"');
    expect(verifyBranch).toContain('pkill -f "$VERIFY_APP_BINARY"');
    expect(verifyBranch).not.toContain('rm -rf -- "$APP_BUNDLE"');
    expect(verifyBranch).not.toContain('pkill -f "${PROCESS_NAME}$"');
  });

  it("ad-hoc signs local macOS bundles so LaunchServices can open them", () => {
    expect(tauriConfig.bundle.macOS.signingIdentity).toBe("-");
  });
});
