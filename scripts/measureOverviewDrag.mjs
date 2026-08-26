import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NODE_COUNT = 9_999;
const sleep = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Chrome was not found. Set CHROME_PATH to a Chromium-compatible executable.",
    );
  }
  return executable;
}

async function waitForUrl(url, timeoutMilliseconds = 15_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Startup connection failures are expected until the process is ready.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function frameStats(frameTimes) {
  const durations = frameTimes
    .slice(1)
    .map((time, index) => time - frameTimes[index])
    .sort((left, right) => left - right);
  const rounded = (value) => (value === null ? null : Number(value.toFixed(1)));
  return {
    frames: durations.length,
    p50: rounded(percentile(durations, 0.5)),
    p95: rounded(percentile(durations, 0.95)),
    p99: rounded(percentile(durations, 0.99)),
    max: rounded(durations.at(-1) ?? null),
    over100: durations.filter((duration) => duration > 100).length,
  };
}

function overviewFixture() {
  const lines = ["# 10k overview drag", ""];
  let depthTwoIndex = 0;
  let depthThreeIndex = 0;
  for (let branch = 1; branch <= 12; branch += 1) {
    lines.push(`- Branch ${branch}`);
    lines.push(`  - B${branch}.1`);
    for (let second = 1; second <= 6; second += 1) {
      lines.push(`    - B${branch}.1.${second}`);
      const thirdCount = depthTwoIndex < 36 ? 5 : 4;
      depthTwoIndex += 1;
      for (let third = 1; third <= thirdCount; third += 1) {
        lines.push(`      - B${branch}.1.${second}.${third}`);
        const fourthCount = depthThreeIndex < 300 ? 5 : 4;
        depthThreeIndex += 1;
        for (let fourth = 1; fourth <= fourthCount; fourth += 1) {
          const prefix = `B${branch}.1.${second}.${third}.${fourth}`;
          lines.push(`        - ${prefix}`);
          for (let leaf = 1; leaf <= 5; leaf += 1) {
            lines.push(
              `          - ${prefix}.${leaf} ${leaf === 3 ? "canvas interaction hardening with long English text for width" : "node content"}`,
            );
          }
        }
      }
    }
  }
  lines.push("- Floating supplement 1");
  lines.push("- Floating supplement 2");
  lines.push("- Floating supplement 3");
  lines.push("");
  assert.equal(lines.filter((line) => /^\s*- /u.test(line)).length, NODE_COUNT);
  return lines.join("\n");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "laniakea-overview-drag-"));
const fixturePath = join(temporaryRoot, "overview-10k.md");
const profilePath = join(temporaryRoot, "chrome-profile");
const previewPort = await freePort();
const debugPort = await freePort();
let previewProcess;
let chromeProcess;
let socket;

try {
  await writeFile(
    fixturePath,
    overviewFixture(),
    "utf8",
  );

  previewProcess = spawn(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(previewPort),
      "--strictPort",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let previewError = "";
  previewProcess.stderr.on("data", (data) => {
    previewError += data;
  });
  await waitForUrl(`http://127.0.0.1:${previewPort}/`).catch((error) => {
    throw new Error(`${error.message}\n${previewError.slice(0, 500)}`);
  });

  chromeProcess = spawn(chromeExecutable(), [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    "--window-size=1600,1000",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeError = "";
  chromeProcess.stderr.on("data", (data) => {
    chromeError += data;
  });
  const versionResponse = await waitForUrl(
    `http://127.0.0.1:${debugPort}/json/version`,
  ).catch((error) => {
    throw new Error(`${error.message}\n${chromeError.slice(0, 500)}`);
  });
  const browserVersion = (await versionResponse.json()).Browser;
  const targets = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/list`)
  ).json();
  const page = targets.find((target) => target.type === "page");
  assert.ok(page, "Chrome did not expose a page target");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.onopen = resolveOpen;
    socket.onerror = reject;
  });
  let messageId = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(message.error.message));
      else callbacks.resolve(message.result);
      return;
    }
    if (
      message.method === "Runtime.exceptionThrown" ||
      (message.method === "Log.entryAdded" &&
        message.params?.entry?.level === "error")
    ) {
      runtimeErrors.push(message.method);
    }
  };
  const cdp = (method, params = {}) =>
    new Promise((resolveMessage, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve: resolveMessage, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error("Browser evaluation failed");
    }
    return response.result?.value;
  };

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("DOM.enable");
  await cdp("Page.navigate", { url: `http://127.0.0.1:${previewPort}/` });
  await sleep(1_000);
  await evaluate(`(() => {
    window.__laniakeaFrames = [];
    window.__laniakeaSampling = false;
    const sample = (time) => {
      if (window.__laniakeaSampling) window.__laniakeaFrames.push(time);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);

  const { root } = await cdp("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "input[type='file']",
  });
  assert.ok(nodeId, "The real import file input was not found");
  await cdp("DOM.setFileInputFiles", { files: [fixturePath], nodeId });

  let mountedNodes = 0;
  let stableSamples = 0;
  const importDeadline = Date.now() + 60_000;
  while (stableSamples < 3 && Date.now() < importDeadline) {
    await sleep(200);
    const nextCount = await evaluate(
      "document.querySelectorAll('.mind-node').length",
    );
    stableSamples = nextCount === mountedNodes && nextCount > 0
      ? stableSamples + 1
      : 0;
    mountedNodes = nextCount;
  }
  assert.equal(mountedNodes, NODE_COUNT, "The 10k overview did not fully mount");
  await sleep(500);

  const target = await evaluate(`(() => {
    const nodes = document.querySelectorAll('.mind-node');
    const element = nodes[Math.floor(nodes.length / 2)];
    if (!element || element.classList.contains('mind-node--root')) return null;
    const bounds = element.getBoundingClientRect();
    return {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
  })()`);
  assert.ok(target, "No draggable overview node was found");

  await evaluate("window.__laniakeaFrames = []; window.__laniakeaSampling = true");
  await cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.x,
    y: target.y,
    button: "left",
    clickCount: 1,
  });
  for (let step = 1; step <= 12; step += 1) {
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: target.x + step * 6,
      y: target.y + step * 9,
      button: "left",
      buttons: 1,
    });
    await sleep(35);
  }
  await cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.x + 72,
    y: target.y + 108,
    button: "left",
    clickCount: 1,
  });
  await sleep(500);
  await evaluate("window.__laniakeaSampling = false");
  const frameTimes = await evaluate("window.__laniakeaFrames");
  const finalNodes = await evaluate(
    "document.querySelectorAll('.mind-node').length",
  );
  assert.equal(finalNodes, NODE_COUNT, "Drag left the rendered map incomplete");
  assert.deepEqual(runtimeErrors, [], "Browser runtime errors occurred during drag");

  console.log(JSON.stringify({
    status: "baseline_only",
    browser: browserVersion,
    viewport: "1600x1000",
    nodes: finalNodes,
    frameDurationMs: frameStats(frameTimes),
  }));
} finally {
  socket?.close();
  chromeProcess?.kill("SIGTERM");
  previewProcess?.kill("SIGTERM");
  await sleep(250);
  await rm(temporaryRoot, { recursive: true, force: true });
}
