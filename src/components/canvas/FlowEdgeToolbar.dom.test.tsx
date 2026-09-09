// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowEdgeToolbar } from "./FlowEdgeToolbar";
import { setColorTheme } from "../../theme/colorTheme";
import { setLanguagePreference } from "../../i18n/locale";

// Dimensions observed in the rendered app. DOM tests cover placement decisions;
// real browser/desktop checks cover CSS geometry, hit-testing and scrolling.
describe("connection controls in the visible canvas", () => {
  let host: HTMLDivElement;
  let root: Root;
  let point: { x: number; y: number };
  let canvasHeight: number;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    point = { x: 380, y: 440 };
    setColorTheme("light");
    setLanguagePreference("zh");
    canvasHeight = 560;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("flow-canvas")) return new DOMRect(0, 0, 760, canvasHeight);
      if (this.classList.contains("topbar")) return new DOMRect(16, 14, 728, 42);
      if (this.classList.contains("flow-edge-toolbar-anchor")) return new DOMRect(point.x, point.y, 0, 0);
      return new DOMRect();
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("flow-edge-toolbar")) return 102;
      if (this.classList.contains("flow-edge-style-panel")) return 268;
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("flow-edge-toolbar")) return 36;
      if (this.classList.contains("flow-edge-style-panel")) {
        return Math.min(237, Number.parseFloat(this.style.maxHeight) || 237);
      }
      return 0;
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    setColorTheme("light");
    setLanguagePreference("zh");
    vi.restoreAllMocks();
  });

  async function openPanel() {
    await act(async () => root.render(
      <div>
        <header className="topbar" />
        <div className="flow-canvas">
          <div className="flow-canvas__content">
            <FlowEdgeToolbar
              anchor={point}
              edge={{ id: "edge-1", from: "node-1", to: "node-2", label: "" }}
              hasManualRoute={false}
              onBeginLabel={() => undefined}
              onChangeStyle={() => undefined}
              onDelete={() => undefined}
              onDeselect={() => undefined}
              onResetRoute={() => undefined}
            />
          </div>
        </div>
      </div>,
    ));
    await act(async () => host.querySelector<HTMLButtonElement>(".flow-edge-toolbar button")!.click());
  }

  function expectReachable() {
    const shell = host.querySelector<HTMLElement>(".flow-edge-toolbar-shell")!;
    const panel = host.querySelector<HTMLElement>(".flow-edge-style-panel")!;
    const left = Number.parseFloat(shell.style.left);
    const top = Number.parseFloat(shell.style.top);
    const panelLeft = left + Number.parseFloat(panel.style.left);
    const panelTop = top + Number.parseFloat(panel.style.top);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + 102).toBeLessThanOrEqual(748);
    expect(top).toBeGreaterThanOrEqual(68); // Below persistent navigation.
    expect(top + 36).toBeLessThanOrEqual(canvasHeight - 12);
    expect(panelLeft).toBeGreaterThanOrEqual(12);
    expect(panelLeft + panel.offsetWidth).toBeLessThanOrEqual(748);
    expect(panelTop).toBeGreaterThanOrEqual(68);
    expect(panelTop + panel.offsetHeight).toBeLessThanOrEqual(canvasHeight - 12);
    return { panel, shell, panelTop, top };
  }

  it.each([[0, 0], [760, 0], [0, 560], [760, 560], [380, 440]])(
    "keeps the toolbar and every style row reachable at (%i, %i)",
    async (x, y) => {
      point = { x, y };
      await openPanel();
      expectReachable();
    },
  );

  it("follows live pan before persisted viewport state and adapts the open panel to resize", async () => {
    await openPanel();
    const before = expectReachable();
    expect(before.panelTop).toBeLessThan(before.top);
    await act(async () => {
      point = { x: 30, y: 40 };
      host.querySelector<HTMLElement>(".flow-canvas__content")!.style.transform = "translate(-350px, -400px)";
    });
    const after = expectReachable();
    expect(after.panelTop).toBeGreaterThan(after.top);
    expect(after.shell.style.left).toBe("12px");
    await act(async () => {
      canvasHeight = 320;
      window.dispatchEvent(new Event("resize"));
    });
    const resized = expectReachable();
    expect(resized.panel.offsetHeight).toBeLessThan(237);
  });

  it("keeps the same connector style slot while its visible color name follows theme and language", async () => {
    await openPanel();
    const swatch = host.querySelector<HTMLButtonElement>(".flow-edge-style-choice--violet")!;
    expect(swatch.getAttribute("aria-label")).toBe("紫色");
    await act(async () => setColorTheme("dark"));
    expect(swatch.getAttribute("aria-label")).toBe("灰青");
    await act(async () => setLanguagePreference("en"));
    expect(swatch.getAttribute("aria-label")).toBe("Gray teal");
    await act(async () => setColorTheme("light"));
    expect(swatch.getAttribute("aria-label")).toBe("Purple");
    expect(host.querySelector(".flow-edge-style-choice--violet")).toBe(swatch);
  });
});
