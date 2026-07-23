import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import { createChild, setNodeText } from "./tree";
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
      selectedId: "experience-2",
    });

    const created = createChild(seed, "experience-2");
    history = commitEditorHistory(history, created);
    const edited = setNodeText(
      created.document,
      created.selectedId,
      "快捷键驱动",
    );
    history = commitEditorHistory(history, edited);

    history = undoEditorHistory(history);
    expect(history.present.document.nodes[created.selectedId].text).toBe(
      "新节点",
    );

    history = undoEditorHistory(history);
    expect(history.present.document.nodes[created.selectedId]).toBeUndefined();
    expect(history.future).toHaveLength(2);
  });

  it("replays the same snapshots in order", () => {
    const seed = createSeedDocument();
    let history = createEditorHistory({
      document: seed,
      selectedId: "root",
    });
    const created = createChild(seed, "root", "新分支");
    history = commitEditorHistory(history, created);
    history = undoEditorHistory(history);
    history = redoEditorHistory(history);

    expect(history.present.document.nodes[created.selectedId].text).toBe(
      "新分支",
    );
  });
});
