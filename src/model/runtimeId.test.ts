import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeId } from "./runtimeId";

describe("runtime identifiers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the platform UUID source when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });

    expect(createRuntimeId("node")).toBe(
      "node-00000000-0000-4000-8000-000000000001",
    );
  });

  it("uses secure random values when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (values: Uint32Array) => {
        values.set([1, 2, 3, 4]);
        return values;
      },
    });

    expect(createRuntimeId()).toBe("0000001-0000002-0000003-0000004");
  });

  it("keeps the non-crypto fallback unique without claiming randomness", () => {
    vi.stubGlobal("crypto", undefined);

    const first = createRuntimeId("node");
    const second = createRuntimeId("node");

    expect(first).not.toBe(second);
  });
});
