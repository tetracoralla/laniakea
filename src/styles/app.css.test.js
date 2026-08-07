import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appStyles = readFileSync(new URL("./app.css", import.meta.url), "utf8");

describe("node editor styles", () => {
  it("uses symmetric vertical padding at every node depth", () => {
    expect(appStyles).toContain(
      ".mind-node__editor {\n  padding-block: var(--node-padding-block);",
    );
    expect(appStyles).not.toContain(
      "calc(var(--node-padding-block) + 2px)",
    );
  });
});
