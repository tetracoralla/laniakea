// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { preferredUserDocumentDirectory } from "./documentFileDialog";

describe("document dialog starting directory", () => {
  const internalDraft =
    "/Volumes/Workspace/Library/Application Support/com.openadam.origin/drafts/未命名.md";

  it("prefers the current user file, then the last chosen folder, then recents", () => {
    expect(
      preferredUserDocumentDirectory(
        "/Volumes/Workspace/Documents/当前.md",
        "/Volumes/Workspace/Desktop",
        ["/Volumes/Workspace/Downloads/最近.md"],
      ),
    ).toBe("/Volumes/Workspace/Documents");

    expect(
      preferredUserDocumentDirectory(
        internalDraft,
        "/Volumes/Workspace/Desktop",
        ["/Volumes/Workspace/Downloads/最近.md"],
      ),
    ).toBe("/Volumes/Workspace/Desktop");

    expect(
      preferredUserDocumentDirectory(
        internalDraft,
        null,
        [internalDraft, "/Volumes/Workspace/Downloads/最近.md"],
      ),
    ).toBe("/Volumes/Workspace/Downloads");
  });

  it("never chooses the application's internal storage folder", () => {
    expect(
      preferredUserDocumentDirectory(
        internalDraft,
        "/Volumes/Workspace/Library/Application Support/com.openadam.origin",
        [internalDraft],
      ),
    ).toBeNull();
  });
});
