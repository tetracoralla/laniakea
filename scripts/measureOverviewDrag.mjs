import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NODE_COUNT = 9_999;
const GESTURE_RUNS = 5;
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

function rounded(value) {
  return value === null || value === undefined
    ? null
    : Number(value.toFixed(1));
}

function distribution(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p50: rounded(percentile(sorted, 0.5)),
    p95: rounded(percentile(sorted, 0.95)),
    max: rounded(sorted.at(-1)),
  };
}

function frameDurations(frameTimes) {
  return frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
}

function durationStats(durations) {
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    frames: sorted.length,
    p50: rounded(percentile(sorted, 0.5)),
    p95: rounded(percentile(sorted, 0.95)),
    p99: rounded(percentile(sorted, 0.99)),
    max: rounded(sorted.at(-1)),
    over50: sorted.filter((duration) => duration > 50).length,
    over100: sorted.filter((duration) => duration > 100).length,
  };
}

function longFrameWindows(frameTimes, thresholdMilliseconds = 50) {
  return frameTimes.slice(1).flatMap((time, index) => {
    const previous = frameTimes[index];
    const duration = time - previous;
    return duration > thresholdMilliseconds
      ? [{
          start: rounded(previous),
          end: rounded(time),
          duration: rounded(duration),
        }]
      : [];
  });
}

function handlerDuration(events, type) {
  const capture = events.find(
    (event) => event.type === type && event.phase === "capture",
  );
  const bubble = events.find(
    (event) => event.type === type && event.phase === "bubble",
  );
  return capture && bubble ? bubble.time - capture.time : null;
}

async function terminateProcess(process) {
  if (!process || process.exitCode !== null) return;
  const exited = new Promise((resolveExit) => process.once("exit", resolveExit));
  process.kill("SIGTERM");
  await Promise.race([exited, sleep(2_000)]);
  if (process.exitCode === null) {
    process.kill("SIGKILL");
    await Promise.race([exited, sleep(1_000)]);
  }
}

async function removeTemporaryRoot(path) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await sleep(150 * (attempt + 1));
    }
  }
  throw lastError;
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
  await writeFile(fixturePath, overviewFixture(), "utf8");
  previewProcess = spawn(process.execPath, [
    resolve("node_modules/vite/bin/vite.js"),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(previewPort),
    "--strictPort",
  ], { stdio: ["ignore", "ignore", "pipe"] });
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
    "--enable-precise-memory-info",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
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
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push({
        kind: message.method,
        text: message.params?.exceptionDetails?.text ?? "browser exception",
      });
    } else if (
      message.method === "Log.entryAdded" &&
      message.params?.entry?.level === "error"
    ) {
      runtimeErrors.push({
        kind: message.method,
        text: message.params.entry.text ?? "browser log error",
      });
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
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return response.result?.value;
  };

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("DOM.enable");
  await cdp("HeapProfiler.enable");
  await cdp("Page.navigate", { url: `http://127.0.0.1:${previewPort}/` });
  await sleep(750);
  await evaluate(`(() => {
    const probe = {
      sampling: false,
      frames: [],
      events: [],
      feedbackAt: null,
      releaseStableAt: null,
      target: null,
      targetId: null,
      observers: [],
    };
    window.__laniakeaProbe = probe;
    const logEvent = (phase) => (event) => {
      if (!probe.sampling) return;
      probe.events.push({
        type: event.type,
        phase,
        key: event instanceof KeyboardEvent ? event.key : null,
        time: performance.now(),
      });
    };
    for (const type of ["pointerdown", "pointermove", "pointerup", "keydown"]) {
      document.addEventListener(type, logEvent("capture"), true);
      document.addEventListener(type, logEvent("bubble"), false);
    }
    const sample = (time) => {
      if (probe.sampling) probe.frames.push(time);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const recordFeedback = () => {
      if (probe.feedbackAt !== null) return;
      const preview = document.querySelector(".node-drag-preview");
      const previewVisible = preview && !preview.hidden && preview.style.opacity !== "0";
      const dragging = probe.target?.dataset.nodeDragging === "true";
      if (previewVisible || dragging) probe.feedbackAt = performance.now();
    };
    window.__startLaniakeaGesture = (run) => {
      probe.observers.forEach((observer) => observer.disconnect());
      probe.observers = [];
      probe.frames = [];
      probe.events = [];
      probe.feedbackAt = null;
      probe.releaseStableAt = null;
      const selector = run === 0
        ? ".mind-node--branch:not(.mind-node--root)"
        : ".mind-node--leaf:not(:has(.mind-node__disclosure))";
      let candidates = [...document.querySelectorAll(selector)];
      if (candidates.length === 0) {
        candidates = [...document.querySelectorAll(".mind-node:not(.mind-node--root)")];
      }
      const hitPoint = (element) => {
        const hitArea = element.querySelector(".mind-node__content") ?? element;
        const bounds = hitArea.getBoundingClientRect();
        if (
          bounds.width <= 0 || bounds.height <= 0 || bounds.right <= 0 ||
          bounds.bottom <= 0 || bounds.left >= innerWidth || bounds.top >= innerHeight
        ) return null;
        const probes = [
          [0.5, 0.5],
          [0.3, 0.5],
          [0.7, 0.5],
          [0.5, 0.3],
          [0.5, 0.7],
        ];
        for (const [xFraction, yFraction] of probes) {
          const x = Math.max(0, Math.min(innerWidth - 1, bounds.left + bounds.width * xFraction));
          const y = Math.max(0, Math.min(innerHeight - 1, bounds.top + bounds.height * yFraction));
          const hit = document.elementFromPoint(x, y);
          if (
            hit?.closest(".mind-node") === element &&
            hit.closest(".mind-node__content")
          ) {
            return { element, x, y };
          }
        }
        return null;
      };
      const fraction = run === 0 ? 0.5 : (run + 1) / (${GESTURE_RUNS} + 2);
      const findClickable = (elements) => {
        const preferredIndex = Math.min(
          elements.length - 1,
          Math.floor(elements.length * fraction),
        );
        for (let distance = 0; distance < Math.min(elements.length, 160); distance += 1) {
          const indices = distance === 0
            ? [preferredIndex]
            : [preferredIndex + distance, preferredIndex - distance];
          for (const index of indices) {
            const candidate = elements[index];
            if (!candidate) continue;
            const point = hitPoint(candidate);
            if (point) return point;
          }
        }
        return null;
      };
      const repeatedTarget = run > 0 && probe.targetId
        ? document.getElementById("mind-node-" + probe.targetId)
        : null;
      let picked = repeatedTarget ? hitPoint(repeatedTarget) : null;
      let targetKind = picked
        ? "repeated-readable-node"
        : run === 0 ? "large-branch" : "leaf";
      if (!picked) picked = findClickable(candidates);
      if (!picked) {
        candidates = [...document.querySelectorAll(".mind-node:not(.mind-node--root)")];
        picked = findClickable(candidates);
        targetKind = "visible-node-fallback";
      }
      if (!picked) return null;
      const target = picked.element;
      probe.target = target;
      probe.targetId = target.dataset.nodeId;
      probe.nodePointerDown = null;
      target.addEventListener("pointerdown", (event) => {
        probe.nodePointerDown = {
          button: event.button,
          buttons: event.buttons,
          pointerId: event.pointerId,
          targetClass: event.target instanceof Element ? event.target.className : null,
          targetNodeId: event.target instanceof Element
            ? event.target.closest(".mind-node")?.dataset.nodeId ?? null
            : null,
        };
      }, { capture: true, once: true });
      const preview = document.querySelector(".node-drag-preview");
      for (const observed of [target, preview].filter(Boolean)) {
        const observer = new MutationObserver(recordFeedback);
        observer.observe(observed, {
          attributes: true,
          attributeFilter: ["data-node-dragging", "hidden", "style"],
        });
        probe.observers.push(observer);
      }
      probe.sampling = true;
      return {
        id: target.dataset.nodeId,
        kind: targetKind,
        x: picked.x,
        y: picked.y,
      };
    };
    window.__finishLaniakeaGesture = () => new Promise((resolve) => {
      const release = probe.events.find(
        (event) => event.type === "pointerup" && event.phase === "capture",
      ) ?? probe.events.find(
        (event) => event.type === "keydown" && event.key === "Escape" &&
          event.phase === "capture",
      );
      const releaseAt = release?.time ?? performance.now();
      let stableFrames = 0;
      let previousSignature = "";
      const check = () => {
        const preview = document.querySelector(".node-drag-preview");
        const dragging = probe.target?.dataset.nodeDragging === "true";
        const signature = [
          probe.target?.getAttribute("style") ?? "",
          preview?.getAttribute("style") ?? "",
          String(preview?.hidden ?? true),
          String(dragging),
        ].join("|");
        stableFrames = signature === previousSignature && !dragging
          ? stableFrames + 1
          : 0;
        previousSignature = signature;
        if (stableFrames >= 6 && performance.now() - releaseAt >= 100) {
          probe.releaseStableAt = performance.now();
          probe.sampling = false;
          probe.observers.forEach((observer) => observer.disconnect());
          probe.observers = [];
          const residualDragMarkers = document.querySelectorAll(
            "[data-node-dragging='true'], [data-node-drop-target='true']",
          ).length;
          resolve({
            events: probe.events,
            feedbackAt: probe.feedbackAt,
            frames: probe.frames,
            releaseStableAt: probe.releaseStableAt,
            residualDragMarkers,
            previewHidden: preview?.hidden ?? true,
            nodePointerDown: probe.nodePointerDown,
            editingNodes: document.querySelectorAll(".mind-node.is-editing").length,
          });
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  })()`);

  const heapBeforeImport = await cdp("Runtime.getHeapUsage");
  const { root } = await cdp("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "input[type='file']",
  });
  assert.ok(nodeId, "The real import file input was not found");
  const importStartedAt = await evaluate("performance.now()");
  await cdp("DOM.setFileInputFiles", { files: [fixturePath], nodeId });
  let mountedNodes = 0;
  const importDeadline = Date.now() + 60_000;
  while (mountedNodes !== NODE_COUNT && Date.now() < importDeadline) {
    await sleep(50);
    mountedNodes = await evaluate("document.querySelectorAll('.mind-node').length");
  }
  assert.equal(mountedNodes, NODE_COUNT, "The 10k overview did not fully mount");
  const importCompletedAt = await evaluate(`new Promise(async (resolve) => {
    await document.fonts.ready;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
  })`);
  await cdp("HeapProfiler.collectGarbage");
  const heapAfterImport = await cdp("Runtime.getHeapUsage");
  await evaluate(`new Promise((resolve) => {
    const zoomIn = document.querySelector("button[aria-label='放大']");
    if (!(zoomIn instanceof HTMLButtonElement)) {
      resolve(false);
      return;
    }
    let remaining = 3;
    const step = () => {
      zoomIn.click();
      remaining -= 1;
      if (remaining === 0) requestAnimationFrame(() => resolve(true));
      else requestAnimationFrame(step);
    };
    step();
  })`);
  let interactionMountedNodes = 0;
  let stableViewportSamples = 0;
  const viewportDeadline = Date.now() + 10_000;
  while (stableViewportSamples < 3 && Date.now() < viewportDeadline) {
    await sleep(75);
    const nextCount = await evaluate("document.querySelectorAll('.mind-node').length");
    stableViewportSamples = nextCount === interactionMountedNodes && nextCount > 0
      ? stableViewportSamples + 1
      : 0;
    interactionMountedNodes = nextCount;
  }
  assert.ok(interactionMountedNodes > 0, "The readable interaction viewport did not mount");
  assert.ok(
    interactionMountedNodes < NODE_COUNT,
    "Readable zoom kept the complete 10k overview mounted instead of contracting the render window",
  );
  await cdp("HeapProfiler.collectGarbage");
  const heapAtInteractionViewport = await cdp("Runtime.getHeapUsage");

  const gestureRuns = [];
  const allFrameDurations = [];
  for (let run = 0; run < GESTURE_RUNS; run += 1) {
    const target = await evaluate(`window.__startLaniakeaGesture(${run})`);
    assert.ok(target, `No draggable overview node was found for run ${run + 1}`);
    const commitsLayout = run === GESTURE_RUNS - 1;
    const stepX = commitsLayout ? 7 : 3;
    const stepY = commitsLayout ? 9 : 4;
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    });
    for (let step = 1; step <= 10; step += 1) {
      await cdp("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: target.x + step * stepX,
        y: target.y + step * stepY,
        button: "left",
        buttons: 1,
      });
      await sleep(20);
    }
    if (commitsLayout) {
      await cdp("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: target.x + stepX * 10,
        y: target.y + stepY * 10,
        button: "left",
        clickCount: 1,
      });
    } else {
      await cdp("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await cdp("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
    }
    const sample = await evaluate("window.__finishLaniakeaGesture()");
    const firstMove = sample.events.find(
      (event) => event.type === "pointermove" && event.phase === "capture",
    );
    const finishEvent = sample.events.find(
      (event) => event.type === "pointerup" && event.phase === "capture",
    ) ?? sample.events.find(
      (event) => event.type === "keydown" && event.key === "Escape" &&
        event.phase === "capture",
    );
    const movementFrames = finishEvent
      ? sample.frames.filter((time) => time <= finishEvent.time)
      : sample.frames;
    const durations = frameDurations(movementFrames);
    allFrameDurations.push(...durations);
    const metrics = {
      run: run + 1,
      target: { id: target.id, kind: target.kind },
      releaseKind: commitsLayout ? "layout-commit" : "cancel-cleanup",
      pointerDownHandlerMs: rounded(handlerDuration(sample.events, "pointerdown")),
      firstMoveHandlerMs: rounded(handlerDuration(sample.events, "pointermove")),
      firstFeedbackMutationMs: rounded(
        firstMove && sample.feedbackAt !== null
          ? sample.feedbackAt - firstMove.time
          : null,
      ),
      layoutReleaseHandlerMs: rounded(handlerDuration(
        sample.events,
        commitsLayout ? "pointerup" : "keydown",
      )),
      releaseToSixStableFramesMs: rounded(
        finishEvent ? sample.releaseStableAt - finishEvent.time : null,
      ),
      frameDurationMs: durationStats(durations),
      longFrameWindows: longFrameWindows(movementFrames),
      residualDragMarkers: sample.residualDragMarkers,
      previewHidden: sample.previewHidden,
    };
    assert.equal(metrics.residualDragMarkers, 0, "Drag markers leaked after release");
    assert.equal(metrics.previewHidden, true, "Drag preview stayed visible after release");
    assert.notEqual(
      metrics.firstFeedbackMutationMs,
      null,
      `The drag did not expose a feedback mutation: ${JSON.stringify({
        target,
        events: sample.events,
        sample,
      })}`,
    );
    gestureRuns.push(metrics);
  }

  await cdp("HeapProfiler.collectGarbage");
  const heapAfterGestures = await cdp("Runtime.getHeapUsage");
  const finalNodes = await evaluate("document.querySelectorAll('.mind-node').length");
  const residualState = await evaluate(`({
    dragging: document.querySelectorAll("[data-node-dragging='true']").length,
    dropTargets: document.querySelectorAll("[data-node-drop-target='true']").length,
    previewVisible: [...document.querySelectorAll(".node-drag-preview")]
      .filter((element) => !element.hidden && element.style.opacity !== "0").length,
  })`);
  assert.ok(finalNodes > 0, "Drag left the readable viewport empty");
  assert.deepEqual(residualState, {
    dragging: 0,
    dropTargets: 0,
    previewVisible: 0,
  });
  assert.deepEqual(runtimeErrors, [], "Browser runtime errors occurred during drag");

  console.log(JSON.stringify({
    status: "measured",
    browser: browserVersion,
    viewport: "1600x1000",
    documentNodes: NODE_COUNT,
    mountedNodes: {
      fitOverview: mountedNodes,
      interactionViewport: interactionMountedNodes,
      afterGestures: finalNodes,
    },
    coldImportToStableMs: rounded(importCompletedAt - importStartedAt),
    heapBytes: {
      beforeImport: heapBeforeImport.usedSize,
      afterImport: heapAfterImport.usedSize,
      atInteractionViewport: heapAtInteractionViewport.usedSize,
      afterGestures: heapAfterGestures.usedSize,
      retainedGestureGrowth:
        heapAfterGestures.usedSize - heapAtInteractionViewport.usedSize,
    },
    interactionSummaryMs: {
      pointerDownHandler: distribution(
        gestureRuns.map((run) => run.pointerDownHandlerMs),
      ),
      firstMoveHandler: distribution(
        gestureRuns.map((run) => run.firstMoveHandlerMs),
      ),
      firstFeedbackMutation: distribution(
        gestureRuns.map((run) => run.firstFeedbackMutationMs),
      ),
      layoutReleaseHandler: distribution(
        gestureRuns.map((run) => run.layoutReleaseHandlerMs),
      ),
      releaseToSixStableFrames: distribution(
        gestureRuns.map((run) => run.releaseToSixStableFramesMs),
      ),
    },
    sustainedFrameDurationMs: durationStats(allFrameDurations),
    gestureRuns,
    residualState,
    runtimeErrors,
  }, null, 2));
} finally {
  socket?.close();
  await terminateProcess(chromeProcess);
  await terminateProcess(previewProcess);
  await removeTemporaryRoot(temporaryRoot);
}
