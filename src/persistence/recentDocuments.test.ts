// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  documentParentDirectory,
  forgetRecentDocument,
  isInternalDocumentPath,
  loadRecentDocuments,
  moveRecentDocumentPath,
  persistRecentDocuments,
  recentDocumentLocation,
  rememberRecentDocument,
  updateRecentDocumentTitle,
  visibleRecentDocuments,
  type RecentDocument,
} from "./recentDocuments";

describe("recent document index", () => {
  beforeEach(() => localStorage.clear());

  it("keeps newest documents first and excludes the current document", () => {
    let documents: RecentDocument[] = [];
    for (let index = 0; index < 7; index += 1) {
      documents = rememberRecentDocument(
        documents,
        `/tmp/${index}.md`,
        `想法 ${index}`,
        `2026-07-28T10:0${index}:00.000Z`,
      );
    }

    const visible = visibleRecentDocuments(
      documents,
      "/tmp/6.md",
    );

    expect(visible).toHaveLength(5);
    expect(visible.map((document) => document.title)).toEqual([
      "想法 5",
      "想法 4",
      "想法 3",
      "想法 2",
      "想法 1",
    ]);
  });

  it("does not truncate the browser document library", () => {
    let documents: RecentDocument[] = [];
    for (let index = 0; index < 24; index += 1) {
      documents = rememberRecentDocument(
        documents,
        `browser://laniakea/${index}`,
        `文档 ${index}`,
        new Date(2026, 6, index + 1).toISOString(),
      );
    }

    persistRecentDocuments(documents);
    expect(loadRecentDocuments()).toHaveLength(24);
    expect(
      visibleRecentDocuments(
        documents,
        "browser://laniakea/23",
        null,
      ),
    ).toHaveLength(23);
  });

  it("updates titles without changing recency and can forget a rebound path", () => {
    const documents = [
      {
        path: "/tmp/draft.md",
        title: "未命名思维",
        lastOpenedAt: "2026-07-28T10:00:00.000Z",
      },
    ];

    const renamed = updateRecentDocumentTitle(
      documents,
      "/tmp/draft.md",
      "正式名称",
    );
    const forgotten = forgetRecentDocument(
      renamed,
      "/tmp/draft.md",
    );

    expect(renamed[0]).toEqual({
      ...documents[0],
      title: "正式名称",
    });
    expect(forgotten).toEqual([]);
  });

  it("replaces a moved draft path without changing its title or recency", () => {
    const source = {
      path: "/app-data/drafts/想法.md",
      title: "想法",
      lastOpenedAt: "2026-07-28T10:00:00.000Z",
    };

    expect(
      moveRecentDocumentPath(
        [source],
        source.path,
        "/Users/adam/Documents/想法.md",
      ),
    ).toEqual([
      {
        ...source,
        path: "/Users/adam/Documents/想法.md",
      },
    ]);
  });

  it("persists only valid metadata instead of document content", () => {
    persistRecentDocuments([
      {
        path: "/tmp/想法.md",
        title: "想法",
        lastOpenedAt: "2026-07-28T10:00:00.000Z",
      },
    ]);

    expect(loadRecentDocuments()).toEqual([
      {
        path: "/tmp/想法.md",
        title: "想法",
        lastOpenedAt: "2026-07-28T10:00:00.000Z",
      },
    ]);
  });

  it("distinguishes user files from internal drafts and summarizes location", () => {
    const internal =
      "/Users/adam/Library/Application Support/com.openadam.origin/drafts/想法.md";

    expect(isInternalDocumentPath(internal)).toBe(true);
    expect(recentDocumentLocation(internal)).toBe("本地草稿");
    expect(
      recentDocumentLocation(
        "/Users/adam/Documents/客户项目/想法.md",
      ),
    ).toBe("Documents/客户项目");
    expect(
      documentParentDirectory("C:\\Users\\adam\\想法.md"),
    ).toBe("C:/Users/adam");
  });
});
