import { describe, expect, it } from "vitest";
import { darkBranchTones } from "./darkBranchTones";
import { markdownToDocument } from "../model/markdown";

describe("dark theme topic colors", () => {
  it("colors sibling topics inside a single wrapper while their details stay together", () => {
    const document = markdownToDocument(`# Review
- Wrapper
  - Region
    - Tool A
      - Model A
      - Price A
    - Tool B
      - Model B
      - Price B
    - Tool C
      - Model C
    - Tool D
      - Model D
`);
    const before = JSON.stringify(document);
    const tones = darkBranchTones(document);
    const id = (text: string) => Object.values(document.nodes).find((node) => node.text === text)!.id;
    expect(new Set(["Tool A", "Tool B", "Tool C", "Tool D"].map((text) => tones[id(text)])).size).toBe(4);
    expect(tones[id("Model A")]).toBe(tones[id("Tool A")]);
    expect(tones[id("Price A")]).toBe(tones[id("Tool A")]);
    expect(tones[id("Model B")]).toBe(tones[id("Tool B")]);
    expect(JSON.stringify(document)).toBe(before);
    document.nodes[id("Tool B")].collapsed = true;
    document.nodes[id("Tool A")].text = "Renamed tool";
    document.viewport = { x: 900, y: -1200, zoom: 0.3 };
    expect(darkBranchTones(document)).toEqual(tones);
  });
});
