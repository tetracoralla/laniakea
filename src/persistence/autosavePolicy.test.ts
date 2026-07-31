import { describe, expect, it } from "vitest";
import { createBlankDocument } from "../data/seed";
import {
  shouldDeferUnboundCopyAutosave,
  sourceContentFingerprint,
} from "./autosavePolicy";

describe("unbound imported-copy autosave policy", () => {
  it("does not replace the recovery draft for viewport-only changes", () => {
    const imported = createBlankDocument();
    const protectedContent = sourceContentFingerprint(imported);
    const moved = {
      ...imported,
      viewport: { x: 120, y: -40, zoom: 0.8 },
    };

    expect(
      shouldDeferUnboundCopyAutosave(
        moved,
        null,
        protectedContent,
      ),
    ).toBe(true);
  });

  it("allows recovery autosave after the imported content changes", () => {
    const imported = createBlankDocument();
    const protectedContent = sourceContentFingerprint(imported);
    const root = imported.nodes[imported.rootId];
    const edited = {
      ...imported,
      title: "已编辑的副本",
      nodes: {
        ...imported.nodes,
        [root.id]: { ...root, text: "已编辑的副本" },
      },
    };

    expect(
      shouldDeferUnboundCopyAutosave(
        edited,
        null,
        protectedContent,
      ),
    ).toBe(false);
  });

  it("never blocks an explicit save to a Markdown path", () => {
    const imported = createBlankDocument();

    expect(
      shouldDeferUnboundCopyAutosave(
        imported,
        "/tmp/imported.md",
        sourceContentFingerprint(imported),
      ),
    ).toBe(false);
  });
});
