// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { preferredUserDocumentDirectory } from "./documentFileDialog";

describe("document dialog starting directory", () => {
  const internalDraft =
    "/Users/adam/Library/Application Support/com.openadam.origin/drafts/未命名.md";

  it("prefers the current user file, then the last chosen folder, then recents", () => {
    expect(
      preferredUserDocumentDirectory(
        "/Users/adam/Documents/当前.md",
        "/Users/adam/Desktop",
        ["/Users/adam/Downloads/最近.md"],
      ),
    ).toBe("/Users/adam/Documents");

    expect(
      preferredUserDocumentDirectory(
        internalDraft,
        "/Users/adam/Desktop",
        ["/Users/adam/Downloads/最近.md"],
      ),
    ).toBe("/Users/adam/Desktop");

    expect(
      preferredUserDocumentDirectory(
        internalDraft,
        null,
        [internalDraft, "/Users/adam/Downloads/最近.md"],
      ),
    ).toBe("/Users/adam/Downloads");
  });

  it("never chooses the application's internal storage folder", () => {
    expect(
      preferredUserDocumentDirectory(
        internalDraft,
        "/Users/adam/Library/Application Support/com.openadam.origin",
        [internalDraft],
      ),
    ).toBeNull();
  });
});
