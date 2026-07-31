// @vitest-environment jsdom

import { act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";
import { singleSelection } from "../model/selection";
import type { MindMapDocument } from "../types/mindmap";
import { useMindMapClipboard } from "./useMindMapClipboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

describe("clipboard document-session isolation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("does not delete from a new document when an old cut finishes late", async () => {
    const write = deferred<void>();
    const applyMutation = vi.fn();
    const notify = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(() => write.promise),
        readText: vi.fn(),
      },
    });

    function Harness() {
      const [document, setDocument] =
        useState<MindMapDocument>(() => createSeedDocument());
      const [sessionId, setSessionId] = useState(1);
      const sessionRef = useRef(sessionId);
      sessionRef.current = sessionId;
      const isCurrent = useCallback(
        (candidate: number) => candidate === sessionRef.current,
        [],
      );
      const clipboard = useMindMapClipboard({
        mindMap: document,
        selection: singleSelection("experience-1"),
        applyMutation,
        documentSessionId: sessionId,
        isDocumentSessionCurrent: isCurrent,
        notify,
        undo: vi.fn(),
      });
      return (
        <>
          <button data-testid="cut" onClick={() => void clipboard.cutSelection()}>
            剪切
          </button>
          <button
            data-testid="switch"
            onClick={() => {
              const next = createSeedDocument();
              next.title = "第二张图";
              setDocument(next);
              sessionRef.current = 2;
              setSessionId(2);
            }}
          >
            切换
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='cut']",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='switch']",
      )!.click();
    });
    await act(async () => {
      write.resolve();
      await write.promise;
      await Promise.resolve();
    });

    expect(applyMutation).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "已剪切节点" }),
    );
  });

  it("does not paste into a new document when an old clipboard read finishes late", async () => {
    const read = deferred<string>();
    const applyMutation = vi.fn();
    const notify = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(),
        readText: vi.fn(() => read.promise),
      },
    });

    function Harness() {
      const [document, setDocument] =
        useState<MindMapDocument>(() => createSeedDocument());
      const [sessionId, setSessionId] = useState(1);
      const sessionRef = useRef(sessionId);
      sessionRef.current = sessionId;
      const isCurrent = useCallback(
        (candidate: number) => candidate === sessionRef.current,
        [],
      );
      const clipboard = useMindMapClipboard({
        mindMap: document,
        selection: singleSelection(document.rootId),
        applyMutation,
        documentSessionId: sessionId,
        isDocumentSessionCurrent: isCurrent,
        notify,
        undo: vi.fn(),
      });
      return (
        <>
          <button
            data-testid="paste"
            onClick={() => void clipboard.pasteClipboard()}
          >
            粘贴
          </button>
          <button
            data-testid="switch"
            onClick={() => {
              const next = createSeedDocument();
              next.title = "第二张图";
              setDocument(next);
              sessionRef.current = 2;
              setSessionId(2);
            }}
          >
            切换
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='paste']",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='switch']",
      )!.click();
    });
    await act(async () => {
      read.resolve("- 延迟内容");
      await read.promise;
      await Promise.resolve();
    });

    expect(applyMutation).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
