import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appStyles = readFileSync(new URL("./app.css", import.meta.url), "utf8");

describe("node editor styles", () => {
  it("uses one vertically centered surface for display and editing", () => {
    expect(appStyles).toContain(
      ".mind-node__content,\n.mind-node__editor-shell {\n  display: flex;\n  align-items: center;\n  justify-content: center;",
    );
    expect(appStyles).toContain(
      ".mind-node__editor {\n  display: block;",
    );
    expect(appStyles).toContain("  padding: 0;");
    expect(appStyles).not.toContain("padding-block: calc(");
  });

  it("keeps overflowed editor lines and the caret reachable", () => {
    const editorRuleStart = appStyles.indexOf(".mind-node__editor {");
    const editorRuleEnd = appStyles.indexOf("\n}", editorRuleStart);
    const editorRule = appStyles.slice(editorRuleStart, editorRuleEnd);

    expect(editorRule).toContain("overflow-x: hidden;");
    expect(editorRule).toContain("overflow-y: auto;");
    expect(editorRule).not.toContain("overflow: hidden;");
  });

  it("clips the canvas without making it a native scroll container", () => {
    const canvasRuleStart = appStyles.indexOf(".mindmap-canvas {");
    const canvasRuleEnd = appStyles.indexOf("\n}", canvasRuleStart);
    const canvasRule = appStyles.slice(canvasRuleStart, canvasRuleEnd);

    expect(canvasRule).toContain("overflow: clip;");
    expect(canvasRule).not.toContain("overflow: hidden;");
  });

  it("uses a square flush connector terminal for second-level nodes", () => {
    const terminalRuleStart = appStyles.indexOf(
      ".mind-node--branch::before {",
    );
    const terminalRuleEnd = appStyles.indexOf("\n}", terminalRuleStart);
    const terminalRule = appStyles.slice(
      terminalRuleStart,
      terminalRuleEnd,
    );

    expect(terminalRuleStart).toBeGreaterThan(-1);
    expect(terminalRule).toContain("left: -3px;");
    expect(terminalRule).toContain("width: 3px;");
    expect(terminalRule).toContain("height: 50%;");
    expect(terminalRule).not.toContain("border-radius");
    expect(appStyles).not.toContain(
      "box-shadow: inset 3px 0 0 var(--branch-tone)",
    );
  });

  it("hides the second-level terminal while selected or editing", () => {
    expect(appStyles).toContain(
      ".mind-node--branch.is-selected::before,\n.mind-node--branch.is-primary::before,\n.mind-node--branch.is-editing::before {\n  display: none;",
    );
  });
});
