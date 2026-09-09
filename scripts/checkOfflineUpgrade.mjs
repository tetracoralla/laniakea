import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build, loadConfigFromFile } from "vite";

// Exercise the production cache builder and worker through a real browser.
// Two small app versions keep the failure specific to offline lazy loading.
const repository = fileURLToPath(new URL("../", import.meta.url));
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "laniakea-offline-upgrade-")));
const config = await loadConfigFromFile({ command: "build", mode: "production" },
  path.join(repository, "vite.config.ts"));
const plugin = config.config.plugins.flat(Infinity)
  .find((candidate) => candidate?.name === "laniakea-offline-asset-manifest");
assert.ok(plugin);
let browser;
let server;
let page;
try {
  for (const version of ["A", "B"]) {
    const root = path.join(temporary, version);
    await mkdir(root);
    await writeFile(path.join(root, "index.html"), '<main><h1></h1><button>Open Flow</button><output></output></main><script type="module" src="/entry.js"></script>');
    await writeFile(path.join(root, "entry.js"), `
      document.querySelector('h1').textContent = 'App ${version}';
      document.querySelector('button').onclick = async () => {
        try { document.querySelector('output').textContent = (await import('./flow.js')).text; }
        catch (error) { document.querySelector('output').textContent = String(error); }
      };
      navigator.serviceWorker.register('/sw.js');
    `);
    await writeFile(path.join(root, "flow.js"), `export const text = 'Flow ${version}';`);
    await build({ configFile: false, root, base: "/", publicDir: path.join(repository, "public"),
      plugins: [plugin], logLevel: "warn", build: { outDir: "dist" } });
  }

  let version = "A";
  const mime = { ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".webmanifest": "application/manifest+json" };
  server = createServer(async (request, response) => {
    try {
      const name = new URL(request.url, "http://localhost").pathname;
      const file = path.join(temporary, version, "dist", name === "/" ? "index.html" : name);
      response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => console.log("Browser error:", error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.getByRole("heading", { name: "App A", exact: true }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Retain the old tab: an upgrade must not break its unused lazy chunks.
  const oldPage = page;
  version = "B";
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(origin);
  await page.getByRole("heading", { name: "App B", exact: true }).waitFor();
  const manifest = JSON.parse(await readFile(path.join(temporary, "B", "dist", "asset-manifest.json"), "utf8"));
  const lazyAsset = manifest.assets.find((name) => path.basename(name).startsWith("flow-"));
  assert.ok(lazyAsset);
  const currentHtml = await readFile(path.join(temporary, "B", "dist", "index.html"), "utf8");
  const deadline = Date.now() + 10_000;
  let cached = false;
  do {
    cached = await page.evaluate(async ({ asset, scope, html }) => {
      const pageResponse = await caches.match(scope);
      return Boolean(await caches.match(asset)) && await pageResponse?.text() === html;
    }, { asset: `${origin}/${lazyAsset}`, scope: `${origin}/`, html: currentHtml });
    if (!cached) await delay(100);
  } while (!cached && Date.now() < deadline);
  assert.ok(cached, "The upgraded app must cache its current page and unused lazy Flow");
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "App B", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open Flow", exact: true }).click();
  await page.getByText("Flow B", { exact: true }).waitFor();
  await oldPage.getByRole("button", { name: "Open Flow", exact: true }).click();
  await oldPage.getByText("Flow A", { exact: true }).waitFor();
  console.log("PASS: existing browser upgraded A → B, reloaded offline and opened unused lazy Flows in both the new and retained old tab");
} catch (error) {
  if (page) console.log("Visible failure state:", await page.locator("body").innerText());
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
  await rm(temporary, { recursive: true, force: true });
}
