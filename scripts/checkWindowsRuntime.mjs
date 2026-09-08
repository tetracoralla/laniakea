import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

// Connect to the installed application's WebView2, not a browser surrogate.
// Only the disposable CI process enables CDP; no test hook ships in the app.
assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
const mode = process.argv[2];
assert.ok(["edit", "reopen", "reinstall", "disk"].includes(mode));
const rootText = "Windows 安装态验证";
const childText = "交付检查";
const finalText = "关闭时仍在编辑的最新内容";
const flowText = "先完成实际任务，再保存并重新打开，确认流程内容也完整保留。";
const output = path.join(process.env.RUNNER_TEMP, "laniakea-runtime");
await mkdir(output, { recursive: true });

if (mode === "disk") {
  const active = JSON.parse(await readFile(path.join(process.env.APPDATA,
    "com.openadam.origin", "active-document.json"), "utf8"));
  const markdown = await readFile(active.path, "utf8");
  for (const text of [rootText, finalText, flowText]) assert.ok(markdown.includes(text), text);
  const block = markdown.match(/^(`{3,}|~{3,})laniakea\r?\n([\s\S]*?)\r?\n\1/m);
  assert.ok(block, "Markdown must contain the persisted Space block");
  const spaces = JSON.parse(block[2]);
  assert.equal(spaces.version, 1);
  assert.ok(spaces.portals.some(({ space }) => space.type === "flow"
    && Object.values(space.nodes).some((node) => node.text === flowText)));
  console.log("PASS: native close persisted the last editor text and Flow to Markdown");
} else {
  let browser;
  let page;
  const errors = [];
  try {
    const endpoint = "http://127.0.0.1:9222";
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${endpoint}/json/version`);
        if (response.ok) break;
      } catch { /* WebView2 is still starting. */ }
      await delay(250);
    }
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
    page = browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("tauri.localhost"));
    assert.ok(page, "The installed Tauri window was not found");
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("application", { name: "思维导图画布" }).waitFor();

    if (mode === "edit") {
      await page.getByRole("button", { name: "新建", exact: true }).click();
      const editor = page.getByRole("textbox", { name: "编辑节点", exact: true });
      if (!(await editor.isVisible())) await page.locator(".mind-node__content").first().dblclick();
      await editor.fill(rootText);
      await editor.press("Tab");
      await editor.fill(childText);
      await editor.press("Enter");
      await page.getByRole("button", { name: childText, exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "下钻为…" }).click();
      await page.getByRole("radio", { name: /^流程/ }).click();
      await page.getByRole("button", { name: "创建流程", exact: true }).click();
      const canvas = page.getByRole("application", { name: "流程画布" });
      await canvas.waitFor();
      const bounds = await canvas.boundingBox();
      assert.ok(bounds);
      await canvas.dblclick({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
      const flowEditor = page.getByRole("textbox", { name: "编辑流程步骤" });
      await flowEditor.fill(flowText);
      await flowEditor.press("Enter");
      await page.getByRole("button", { name: "返回上层图" }).click();
      await page.locator(".subspace-portal__content").filter({ hasText: flowText }).waitFor();
      await page.screenshot({ path: path.join(output, "windows-edit.png") });
      await page.getByRole("button", { name: childText, exact: true }).dblclick();
      await editor.fill(finalText);
      // Leave this textarea uncommitted. PowerShell now sends native WM_CLOSE.
      console.log("PASS: installed editor created a mind map and a Flow; last edit awaits native close");
    } else {
      await page.getByRole("button", { name: rootText, exact: true }).waitFor();
      await page.getByRole("button", { name: finalText, exact: true }).waitFor();
      await page.locator(".subspace-portal__content").filter({ hasText: flowText }).dblclick();
      await page.locator(".flow-node__content").filter({ hasText: flowText }).waitFor();
      await page.screenshot({ path: path.join(output, `windows-${mode}.png`) });
      await page.getByRole("button", { name: "返回上层图" }).click();
      console.log(`PASS: ${mode} preserved visible mind-map and Flow content`);
    }
    assert.deepEqual(errors, [], "Uncaught errors in the installed WebView");
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, `windows-${mode}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    // Disconnect from the existing WebView; the OS close request is separate.
    await browser?.close();
  }
}
