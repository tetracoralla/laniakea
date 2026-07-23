import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  createChild,
  deleteSelectedSubtrees,
  setNodeText,
} from "./tree";
import { singleSelection } from "./selection";
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from "./history";

describe("atomic editor history", () => {
  it("handles consecutive undo without leaving a created node behind", () => {
    const seed = createSeedDocument();
    let history = createEditorHistory({
      document: seed,
      selection: singleSelection("experience-2"),
    });

    const created = createChild(seed, "experience-2");
    history = commitEditorHistory(history, created);
    const edited = setNodeText(
      created.document,
      created.selection.primaryId!,
      "快捷键驱动",
    );
    history = commitEditorHistory(history, edited);

    history = undoEditorHistory(history);
    expect(
      history.present.document.nodes[created.selection.primaryId!].text,
    ).toBe(
      "新节点",
    );

    history = undoEditorHistory(history);
    expect(
      history.present.document.nodes[created.selection.primaryId!],
    ).toBeUndefined();
    expect(history.future).toHaveLength(2);
  });

  it("replays the same snapshots in order", () => {
    const seed = createSeedDocument();
    let history = createEditorHistory({
      document: seed,
      selection: singleSelection("root"),
    });
    const created = createChild(seed, "root", "新分支");
    history = commitEditorHistory(history, created);
    history = undoEditorHistory(history);
    history = redoEditorHistory(history);

    expect(
      history.present.document.nodes[created.selection.primaryId!].text,
    ).toBe(
      "新分支",
    );
  });

  it("restores an entire batch deletion in one undo step", () => {
    const seed = createSeedDocument();
    let history = createEditorHistory({
      document: seed,
      selection: {
        primaryId: "experience",
        selectedIds: ["experience", "path"],
      },
    });
    const deleted = deleteSelectedSubtrees(
      seed,
      history.present.selection,
    );
    history = commitEditorHistory(history, deleted);

    expect(history.present.document.nodes.experience).toBeUndefined();
    expect(history.present.document.nodes.path).toBeUndefined();
    history = undoEditorHistory(history);
    expect(history.present.document.nodes.experience).toBeDefined();
    expect(history.present.document.nodes.path).toBeDefined();
    expect(history.past).toHaveLength(0);
  });
});
