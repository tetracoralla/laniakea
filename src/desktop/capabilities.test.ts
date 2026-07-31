import { describe, expect, it } from "vitest";
import desktopCapability from "../../src-tauri/capabilities/default.json";

describe("desktop window capabilities", () => {
  it("allows the intercepted native close action to hide the main window", () => {
    expect(desktopCapability.permissions).toContain("core:window:allow-hide");
  });
});
