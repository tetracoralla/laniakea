// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import { COLOR_THEME_KEY, getColorTheme, initializeColorTheme } from "../../theme/colorTheme";

describe("theme choice in the existing More menu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let stopTheme: () => void;
  const documentAction = vi.fn();
  const props = {
    title: "明天的计划",
    onTitleChange: documentAction,
    onSearch: documentAction,
    onNew: documentAction,
    onImport: documentAction,
    onSave: documentAction,
    onSaveAs: documentAction,
    onCopyMarkdown: documentAction,
    onShortcutSettings: documentAction,
    currentDocumentPath: null,
    recentDocuments: [],
    onOpenRecent: documentAction,
    onRevealCurrent: documentAction,
    onRevealRecent: documentAction,
    onCopyDocumentPath: documentAction,
    onMoveRecent: documentAction,
    onForgetRecent: documentAction,
    showDesktopActions: false,
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.head.innerHTML = '<meta name="theme-color" content="#f8f9fc">';
    documentAction.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    stopTheme = initializeColorTheme();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    stopTheme();
    container.remove();
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.theme;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => root.render(<TopBar {...props} />));
  }

  async function openMenu() {
    const more = container.querySelector<HTMLButtonElement>('[aria-label="更多"]')!;
    await act(async () => more.click());
    return more;
  }

  function themeAction() {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => button.textContent?.includes("模式"))!;
  }

  it("keeps light as the default and toggles from the keyboard-reachable menu without document actions", async () => {
    await render();
    expect(getColorTheme()).toBe("light");
    const more = await openMenu();
    const menu = container.querySelector('[role="menu"]')!;
    await act(async () => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement).toBe(themeAction());
    expect(themeAction().textContent).toBe("切换到深色模式");
    await act(async () => themeAction().click());
    expect(getColorTheme()).toBe("dark");
    expect(localStorage.getItem(COLOR_THEME_KEY)).toBe("dark");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(container.querySelector("input")?.value).toBe("明天的计划");
    expect(documentAction).not.toHaveBeenCalled();

    // A new application mount restores the preference; switching back remains
    // reachable and does not change the document or its undo history.
    await act(async () => root.unmount());
    root = createRoot(container);
    stopTheme();
    delete document.documentElement.dataset.theme;
    stopTheme = initializeColorTheme();
    await render();
    expect(getColorTheme()).toBe("dark");
    await openMenu();
    expect(themeAction().textContent).toBe("切换到浅色模式");
    await act(async () => themeAction().click());
    expect(getColorTheme()).toBe("light");
    expect(localStorage.getItem(COLOR_THEME_KEY)).toBe("light");
    expect(documentAction).not.toHaveBeenCalled();
  });

  it("still changes the current session when preference storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    stopTheme();
    stopTheme = initializeColorTheme();
    await render();
    await openMenu();
    await act(async () => themeAction().click());
    expect(getColorTheme()).toBe("dark");
    await openMenu();
    await act(async () => themeAction().click());
    expect(getColorTheme()).toBe("light");
  });

  it("tracks another window's preference without treating document storage updates as theme changes", async () => {
    await render();
    localStorage.setItem(COLOR_THEME_KEY, "dark");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "origin.document", storageArea: localStorage }));
    });
    expect(getColorTheme()).toBe("light");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: COLOR_THEME_KEY, storageArea: localStorage }));
    });
    expect(getColorTheme()).toBe("dark");
    await openMenu();
    expect(themeAction().textContent).toBe("切换到浅色模式");
    localStorage.clear();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    });
    expect(getColorTheme()).toBe("light");
    expect(themeAction().textContent).toBe("切换到深色模式");
    expect(documentAction).not.toHaveBeenCalled();
  });

  it("restores the dark canvas before app startup and then releases the temporary paint", () => {
    const html = readFileSync(resolve("index.html"), "utf8");
    const bootstrap = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
    localStorage.setItem(COLOR_THEME_KEY, "dark");
    window.eval(bootstrap);
    expect(getColorTheme()).toBe("dark");
    expect(document.documentElement.style.backgroundColor).toBe("rgb(25, 34, 29)");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#19221d");
    stopTheme();
    stopTheme = initializeColorTheme();
    expect(document.documentElement.style.backgroundColor).toBe("");
    expect(getColorTheme()).toBe("dark");
  });
});
