import { describe, expect, it } from "vitest";
import type { FlowNode, FlowSpace } from "../types/mindmap";
import {
  compileFlowConnectors,
  computeFlowLayout,
  flowConnectorCrossings,
  flowConnectorDeleteAnchor,
  flowConnectorPath,
  flowConnectorPoint,
  flowConnectorPointOnRoute,
  flowConnectorRoute,
  flowConnectorPathFromRoute,
  flowRouteAdjustmentHandle,
  flowRouteIntersectsNode,
  flowNavigationTarget,
  includeFlowConnectorBounds,
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
  it("compiles the visible flow through one fixed graph view plan", () => {
    const flow = spaceWith(
      [
        node("decision", "decision", "是否通过"),
        node("left", "step", "返工"),
        node("right", "step", "发布"),
      ],
      [
        ["decision", "left"],
        ["decision", "right"],
      ],
    );
    flow.edges = flow.edges.map((edge, index) => ({
      ...edge,
      label: index === 0 ? "否" : "是",
      fromPort: "down",
      toPort: "up",
    }));
    const layout = computeFlowLayout(flow, measurePerGlyph(14));
    const connectors = compileFlowConnectors(flow, layout, measurePerGlyph(6));

    expect(connectors.map((connector) => connector.edgeId)).toEqual(["edge-0", "edge-1"]);
    expect(connectors.every((connector) =>
      connector.route.fromPort === "down" && connector.route.toPort === "up"
    )).toBe(true);
    expect(new Set(connectors.map((connector) => connector.route.start.x)).size).toBe(2);
    expect(connectors.every((connector) =>
      connector.route.points.slice(0, -1).every((point, pointIndex) => {
        const next = connector.route.points[pointIndex + 1];
        return Math.abs(point.x - next.x) < 0.01 || Math.abs(point.y - next.y) < 0.01;
      })
    )).toBe(true);
  });

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

  it("routes long edges as rounded orthogonal lines and keeps the label on that route", () => {
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
    expect(flowConnectorPath(from, to)).toContain(" Q ");
    expect(flowConnectorPath(from, to)).not.toContain(" C ");
    expect(point.y).toBeGreaterThan(from.y + from.height);
    expect(point.y).toBeLessThan(to.y);
  });

  it("honors an explicitly chosen source and target connector side", () => {
    const from = {
      id: "from",
      x: 100,
      y: 100,
      width: 196,
      height: 54,
      level: 0,
    };
    const to = {
      id: "to",
      x: 420,
      y: 100,
      width: 196,
      height: 54,
      level: 0,
    };

    expect(flowConnectorPath(from, to, "down", "up")).toMatch(
      /^M 198 154 L 198 /,
    );
  });

  it("keeps a reverse mixed-port route fully orthogonal", () => {
    const from = {
      id: "from",
      x: 388,
      y: 340,
      width: 196,
      height: 54,
      level: 0,
    };
    const to = {
      id: "to",
      x: 140,
      y: 64,
      width: 172,
      height: 76,
      level: 0,
    };
    const route = flowConnectorRoute(from, to, "right", "down");

    expect(route.points.slice(0, -1).every((point, index) => {
      const next = route.points[index + 1];
      return Math.abs(point.x - next.x) < 0.01 ||
        Math.abs(point.y - next.y) < 0.01;
    })).toBe(true);
    expect(flowConnectorPath(from, to, "right", "down")).not.toContain(" C ");
  });

  it("renders line variants and moves one explicit orthogonal corridor", () => {
    const space = {
      ...spaceWith([
        node("from", "step", "起点"),
        node("to", "step", "终点"),
      ], [["from", "to"]]),
      positions: { from: { x: 0, y: 100 }, to: { x: 500, y: 100 } },
      edgeRoutes: { "edge-0": { axis: "y" as const, coordinate: 240 } },
    };
    const layout = computeFlowLayout(space);
    const adjusted = compileFlowConnectors(space, layout)[0]!.route;

    expect(adjusted.points.some(({ y }) => y === 240)).toBe(true);
    expect(adjusted.points.slice(0, -1).every((point, index) => {
      const next = adjusted.points[index + 1];
      return point.x === next.x || point.y === next.y;
    })).toBe(true);
    expect(flowRouteAdjustmentHandle(adjusted)).toMatchObject({
      axis: "y",
      coordinate: 240,
    });
    expect(flowConnectorPathFromRoute(adjusted, [], "rounded")).toContain(" Q ");
    expect(flowConnectorPathFromRoute(adjusted, [], "orthogonal")).not.toContain(" Q ");
    expect(flowConnectorPathFromRoute(adjusted, [], "straight")).not.toContain("240");
    expect(flowConnectorPathFromRoute(adjusted, [], "curved")).toContain(" C ");
    expect(flowConnectorPointOnRoute(adjusted, 0.34, "straight").y)
      .toBeCloseTo(adjusted.start.y);
    expect(flowConnectorPointOnRoute(adjusted, 0.34, "curved").y)
      .toBeCloseTo(adjusted.start.y);
    expect(flowConnectorPointOnRoute(adjusted, 0.34, "rounded").y)
      .not.toBeCloseTo(adjusted.start.y);
  });

  it("keeps a short manually moved corridor as the active adjustment handle", () => {
    const routeOverride = { axis: "y" as const, coordinate: 240 };
    const space = {
      ...spaceWith([
        node("from", "step", "起点"),
        node("to", "step", "终点"),
      ], [["from", "to"]]),
      positions: { from: { x: 0, y: 100 }, to: { x: 268, y: 100 } },
      edgeRoutes: { "edge-0": routeOverride },
    };
    const adjusted = compileFlowConnectors(space, computeFlowLayout(space))[0]!.route;

    expect(flowRouteAdjustmentHandle(adjusted, routeOverride)).toMatchObject({
      axis: "y",
      coordinate: 240,
    });
  });

  it("includes a manual corridor in fit bounds", () => {
    const space = {
      ...spaceWith([
        node("from", "step", "起点"),
        node("to", "step", "终点"),
      ], [["from", "to"]]),
      positions: { from: { x: 0, y: 100 }, to: { x: 500, y: 100 } },
      edgeRoutes: { "edge-0": { axis: "y" as const, coordinate: -420 } },
    };
    const base = computeFlowLayout(space);
    const withConnectors = includeFlowConnectorBounds(space, base);

    expect(base.minY).toBeGreaterThan(-420);
    expect(withConnectors.minY).toBeLessThan(-420);
    expect(withConnectors.height).toBeGreaterThan(base.height);
  });

  it("adds a bridge to the horizontal edge at an unrelated line crossing", () => {
    const left = { id: "left", x: 0, y: 100, width: 196, height: 54, level: 0 };
    const right = { id: "right", x: 500, y: 100, width: 196, height: 54, level: 0 };
    const top = { id: "top", x: 202, y: -120, width: 196, height: 54, level: 0 };
    const bottom = { id: "bottom", x: 202, y: 300, width: 196, height: 54, level: 0 };
    const horizontal = flowConnectorRoute(left, right, "right", "left");
    const vertical = flowConnectorRoute(top, bottom, "down", "up");
    const crossings = flowConnectorCrossings([
      { edgeId: "horizontal", fromId: "left", route: horizontal, toId: "right" },
      { edgeId: "vertical", fromId: "top", route: vertical, toId: "bottom" },
    ]);

    expect(crossings.horizontal).toHaveLength(1);
    expect(crossings.horizontal[0]).toMatchObject({ x: 300, y: 127 });
    expect(
      flowConnectorPath(left, right, "right", "left", crossings.horizontal),
    ).toContain("Q 300 121");
  });

  it("routes around an unrelated node instead of drawing a hidden connection through it", () => {
    const from = { id: "from", x: 0, y: 100, width: 196, height: 54, level: 0 };
    const obstacle = { id: "obstacle", x: 270, y: 70, width: 196, height: 114, level: 0 };
    const to = { id: "to", x: 620, y: 100, width: 196, height: 54, level: 0 };
    const route = flowConnectorRoute(
      from,
      to,
      "right",
      "left",
      [from, obstacle, to],
    );

    expect(route.points.some((point) => point.y <= obstacle.y - 14 ||
      point.y >= obstacle.y + obstacle.height + 14)).toBe(true);
    expect(route.points.slice(0, -1).every((point, index) => {
      const next = route.points[index + 1];
      return Math.abs(point.x - next.x) < 0.01 ||
        Math.abs(point.y - next.y) < 0.01;
    })).toBe(true);
  });

  it("anchors the edge delete control beside the line, clear of nodes and endpoints", () => {
    const from = { id: "from", x: 0, y: 100, width: 196, height: 54, level: 0 };
    const to = { id: "to", x: 400, y: 100, width: 196, height: 54, level: 0 };
    const route = flowConnectorRoute(from, to, "right", "left");
    const anchor = flowConnectorDeleteAnchor(route, [from, to]);

    // 中点在 y=127 的水平线上：法线偏移后应落在直线下方，且不压任何节点
    expect(anchor.y).toBeGreaterThan(127);
    const coversNode = (x: number, y: number) =>
      [from, to].some((node) =>
        x > node.x - 2 && x < node.x + node.width + 2 &&
        y > node.y - 2 && y < node.y + node.height + 2,
      );
    expect(coversNode(anchor.x, anchor.y)).toBe(false);
  });

  it("keeps manually placed negative coordinates stable while exposing fit bounds", () => {
    const flow = {
      ...spaceWith([node("step", "step", "自由节点")], []),
      positions: { step: { x: -320, y: -180 } },
    };
    const layout = computeFlowLayout(flow);

    expect(layout.nodes.step).toMatchObject({ x: -320, y: -180 });
    expect(layout.minX).toBeLessThan(-320);
    expect(layout.minY).toBeLessThan(-180);
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

describe("reverse approaches to fixed ports", () => {
  it.each([0, 1, 2, 3])("routes around both endpoint bodies after rotation %s", async (turns) => {
    const { flowRouteIntersectsNode } = await import("./flowLayout");
    const sourceId = "source";
    const targetId = "target";
    const space = spaceWith([node(sourceId, "step", "提交"), node(targetId, "step", "审核")], [[sourceId, targetId]]);
    const ports = ["right", "down", "left", "up"] as const;
    const rotate = (x: number, y: number) => {
      for (let i = 0; i < turns; i++) [x, y] = [-y, x];
      return { x, y };
    };
    space.positions = {
      [sourceId]: rotate(100, 300),
      [targetId]: rotate(270, 120),
    };
    space.edges = space.edges.map((edge) => ({
      ...edge, fromPort: ports[turns], toPort: ports[(turns + 2) % 4],
    }));
    const layout = computeFlowLayout(space);
    const route = compileFlowConnectors(space, layout)[0].route;
    for (const node of Object.values(layout.nodes)) {
      expect(flowRouteIntersectsNode(route.points, node)).toBe(false);
    }
    expect(route.fromPort).toBe(ports[turns]);
    expect(route.toPort).toBe(ports[(turns + 2) % 4]);
  });
});


describe("parallel flow paths", () => {
  it.each([[150, -140], [150, 140], [-250, 0], [400, 0], [0, -140]])(
    "keeps three parallel approaches clear of both bodies at %s,%s", (x, y) => {
      const flow = spaceWith([node("a", "step", "提交"), node("b", "step", "审核")],
        [["a", "b"], ["a", "b"], ["a", "b"]]);
      flow.positions = { a: { x: 0, y: 0 }, b: { x, y } };
      flow.edges = flow.edges.map((edge) => ({ ...edge, fromPort: "right", toPort: "left" }));
      const layout = computeFlowLayout(flow);
      const routes = compileFlowConnectors(flow, layout);
      expect(new Set(routes.map(({ route }) => JSON.stringify(route.points))).size).toBe(3);
      for (const { route } of routes) {
        expect(route.fromPort).toBe("right");
        expect(route.toPort).toBe("left");
        for (const box of Object.values(layout.nodes)) {
          expect(flowRouteIntersectsNode(route.points, box)).toBe(false);
        }
      }
    },
  );
  it("gives repeated endpoint pairs separate corridors while retaining separate identities", () => {
    const space = spaceWith([node("a", "step", "提交"), node("b", "step", "审核")], [["a", "b"], ["a", "b"], ["a", "b"]]);
    space.edges = space.edges.map((edge) => ({ ...edge, fromPort: "down", toPort: "down" }));
    space.positions = { a: { x: 100, y: 200 }, b: { x: 400, y: 100 } };
    const routes = compileFlowConnectors(space, computeFlowLayout(space));
    expect(new Set(routes.map(({ route }) => Math.max(...route.points.map(({ y }) => y)))).size).toBe(3);
    expect(routes.map(({ edgeId }) => edgeId)).toEqual(space.edges.map(({ id }) => id));
  });
});

it("keeps a dragged multi-line annotation inside fit-to-content bounds", () => {
  const space = spaceWith([node("a", "step", "Submit"), node("b", "step", "Review")], [["a", "b"]]);
  space.edges[0].label = "Supplement materials\nThen resubmit";
  space.edgeLabelOffsets = { "edge-0": { x: 1600, y: 1200 } };
  const layout = computeFlowLayout(space);
  const routes = compileFlowConnectors(space, layout);
  const point = flowConnectorPointOnRoute(routes[0].route, 0.5);
  const bounds = includeFlowConnectorBounds(space, layout, undefined, routes);
  expect(bounds.minX + bounds.width).toBeGreaterThan(point.x + 1600 + 100);
  expect(bounds.minY + bounds.height).toBeGreaterThan(point.y + 1200 + 23);
});
