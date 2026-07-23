import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  loadLocalDocument,
  saveLocalDocument,
} from "./localDocumentStore";

const values = new Map<string, string>();
let failWrites = false;
const storage = {
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() {
    return values.size;
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
  setItem: (key: string, value: string) => {
    if (failWrites) throw new Error("quota exceeded");
    values.set(key, value);
  },
} satisfies Storage;

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

describe("local document persistence errors", () => {
  beforeEach(() => {
    values.clear();
    failWrites = false;
  });

  it("rejects a failed write instead of reporting it as saved", async () => {
    failWrites = true;
    await expect(saveLocalDocument(createSeedDocument())).rejects.toThrow(
      "无法写入本地文件",
    );
  });

  it("preserves invalid legacy data under a recovery key", async () => {
    values.set("origin.mindmap.v1", "{not-json");

    const result = await loadLocalDocument();

    expect(result.document).toBeNull();
    expect(values.has("origin.mindmap.v1")).toBe(false);
    expect(
      [...values.keys()].some((key) =>
        key.startsWith("origin.mindmap.v1.corrupt."),
      ),
    ).toBe(true);
  });
});
