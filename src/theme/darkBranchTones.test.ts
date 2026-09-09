import { describe, expect, it } from "vitest";
import { darkBranchTones } from "./darkBranchTones";
import { markdownToDocument } from "../model/markdown";

describe("dark theme topic colors", () => {
  it("colors the first sibling topics after title wrappers and keeps every deeper fork together", () => {
    const document = markdownToDocument(`# Review
- Wrapper
  - Region
    - Tool A
      - Model A
        - Plan
        - Execute
          - Read
          - Write
      - Price A
        - Monthly
        - Annual
    - Tool B
      - Model B
        - CLI
          - Desktop app
          - Command
        - MCP
          - Server
        - Plugin
          - Skill
            - Instructions
          - Figma
            - Translate
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
    for (const topic of ["Tool A", "Tool B", "Tool C", "Tool D"]) {
      const pending = [...document.nodes[id(topic)].children];
      while (pending.length) {
        const node = document.nodes[pending.pop()!]!;
        expect(tones[node.id], `${topic} → ${node.text}`).toBe(tones[id(topic)]);
        pending.push(...node.children);
      }
    }
    expect(JSON.stringify(document)).toBe(before);
    document.nodes[id("Tool B")].collapsed = true;
    document.nodes[id("Tool A")].text = "Renamed tool";
    document.viewport = { x: 900, y: -1200, zoom: 0.3 };
    expect(darkBranchTones(document)).toEqual(tones);
  });

  it("gives terminal topics their own color and does not recolor them when details are added", () => {
    const document = markdownToDocument(`# Outline
- Root
  - Wrapper
    - Topic A
      - Detail
    - Topic B
    - Topic C
`);
    const id = (text: string) => Object.values(document.nodes).find((node) => node.text === text)!.id;
    const before = darkBranchTones(document);
    expect(new Set(["Topic A", "Topic B", "Topic C"].map((text) => before[id(text)])).size).toBe(3);
    const parent = document.nodes[id("Topic B")];
    const template = document.nodes[id("Detail")];
    for (const suffix of ["one", "two"]) {
      const detailId = `new-detail-${suffix}`;
      document.nodes[detailId] = { ...template, id: detailId, text: suffix, parentId: parent.id, children: [] };
      parent.children.push(detailId);
    }
    const after = darkBranchTones(document);
    for (const nodeId of Object.keys(before)) expect(after[nodeId]).toBe(before[nodeId]);
    for (const childId of parent.children) expect(after[childId]).toBe(after[parent.id]);
  });

  it("applies the same single color boundary to an independent floating tree", () => {
    const document = markdownToDocument(`# Outline
- Root
  - Main A
  - Main B
- Floating wrapper
  - Floating title
    - Topic A
      - Nested group one
        - One
      - Nested group two
        - Two
    - Topic B
      - Other detail
`);
    const id = (text: string) => Object.values(document.nodes).find((node) => node.text === text)!.id;
    expect(document.floatingRoots).toHaveLength(1);
    const tones = darkBranchTones(document);
    expect(tones[id("Main A")]).not.toBe(tones[id("Main B")]);
    expect(tones[id("Topic A")]).not.toBe(tones[id("Topic B")]);
    for (const text of ["Nested group one", "One", "Nested group two", "Two"]) {
      expect(tones[id(text)]).toBe(tones[id("Topic A")]);
    }
    expect(tones[id("Other detail")]).toBe(tones[id("Topic B")]);
  });
});
