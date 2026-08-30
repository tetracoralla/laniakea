import { describe, expect, it } from "vitest";
import type { FlowNode, FlowSpace } from "../types/mindmap";
import {
  computeFlowLayout,
  flowConnectorPath,
  flowConnectorPoint,
  flowNavigationTarget,
} from "./flowLayout";

const now = "2026-08-27T00:00:00.000Z";

function node(id: string, kind: FlowNode["kind"], text: string): FlowNode {
  return { id, text, kind, createdAt: now, updatedAt: now };
}

function spaceWith(nodes: FlowNode[], edges: Array<[string, string]>): FlowSpace {
  return {
    id: "space-1",
    type: "flow",
    anchorNodeId: "anchor",
    nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
    edges: edges.map(([from, to], index) => ({
      id: `edge-${index}`,
      from,
      to,
      label: "",
    })),
    viewport: { x: 96, y: 72, zoom: 1 },
    updatedAt: now,
  };
}

const measurePerGlyph =
  (glyphWidth: number) => (text: string) =>
    Array.from(text).length * glyphWidth;

describe("computeFlowLayout node sizing", () => {
  it("keeps short single-line steps at the base pill size", () => {
    const space = spaceWith(
      [
        node("start", "start", "开始"),
        node("step", "step", "用户调研"),
        node("end", "end", "完成"),
      ],
      [
        ["start", "step"],
        ["step", "end"],
      ],
    );
    const layout = computeFlowLayout(space, measurePerGlyph(14));
    expect(layout.nodes.step).toMatchObject({ width: 196, height: 54 });
  });

  it("grows step height with wrapped lines instead of overflowing the border", () => {
    const longText = "把回收的问卷按照地区、年龄和职业维度做交叉分析并输出报告";
    const space = spaceWith(
      [node("step", "step", longText)],
      [],
    );
    const layout = computeFlowLayout(space, measurePerGlyph(14));
    const step = layout.nodes.step;
    expect(step.width).toBe(196);
    // 33 个 14px 字符在 160px 内容宽度内折成 3 行：3*20 行高 + 20 上下内边距。
    expect(step.height).toBeGreaterThanOrEqual(80);
  });

  it("grows the decision rhombus so the wrapped text rectangle stays inside", () => {
    const space = spaceWith(
      [node("decision", "decision", "问卷结果是否达到回收率目标线以上")],
      [],
    );
    const layout = computeFlowLayout(space, measurePerGlyph(14));
    const decision = layout.nodes.decision;
    const textWidth = Math.min(116, 16 * 14);
    const textHeight = Math.ceil((16 * 14) / 116) * 20;
    const halfWidth = decision.width / 2;
    const halfHeight = decision.height / 2;
    expect(
      textWidth / 2 / halfWidth + textHeight / 2 / halfHeight,
    ).toBeLessThanOrEqual(1);
    expect(decision.width).toBeGreaterThanOrEqual(172);
    expect(decision.height).toBeGreaterThanOrEqual(76);
  });

  it("sizes empty nodes by their visible placeholder", () => {
    const space = spaceWith([node("step", "step", "")], []);
    const layout = computeFlowLayout(space, measurePerGlyph(14));
    expect(layout.nodes.step).toMatchObject({ width: 196, height: 54 });
  });

  it("navigates between visible flow nodes in the requested direction", () => {
    const flow = spaceWith(
      [
        node("start", "start", "开始"),
        node("decision", "decision", "是否通过"),
        node("left", "step", "返工"),
        node("right", "step", "发布"),
      ],
      [
        ["start", "decision"],
        ["decision", "left"],
        ["decision", "right"],
      ],
    );

    expect(flowNavigationTarget(flow, "decision", "up")).toBe("start");
    expect(flowNavigationTarget(flow, "left", "right")).toBe("right");
    expect(["left", "right"]).toContain(
      flowNavigationTarget(flow, "decision", "down"),
    );
  });

  it("routes edges that skip a row through a side lane with the label", () => {
    const from = {
      id: "from",
      x: 100,
      y: 100,
      width: 172,
      height: 76,
      level: 1,
    };
    const to = {
      id: "to",
      x: 100,
      y: 600,
      width: 196,
      height: 54,
      level: 4,
    };
    const point = flowConnectorPoint(from, to);
    expect(flowConnectorPath(from, to)).toContain(" L ");
    expect(point.x).toBeGreaterThan(from.x + from.width / 2 + 100);
    expect(point.y).toBe(from.y + from.height + 64);
    expect(point.y).toBeGreaterThan(from.y + from.height);
  });

  it("resolves the longest level in a dense merge graph without a visit budget", () => {
    const nodes = Array.from({ length: 80 }, (_, index) =>
      node(`node-${index}`, index === 0 ? "start" : "step", `步骤 ${index}`),
    );
    const edges: Array<[string, string]> = [];
    nodes.forEach((target, targetIndex) => {
      for (let sourceIndex = 0; sourceIndex < targetIndex; sourceIndex += 1) {
        edges.push([nodes[sourceIndex].id, target.id]);
      }
    });

    const layout = computeFlowLayout(spaceWith(nodes, edges));

    expect(layout.nodes["node-79"].level).toBe(79);
  });
});
