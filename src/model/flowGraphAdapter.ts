import {
  SEMANTIC_GRAPH_VERSION,
  assertSemanticGraph,
  type PortSide,
  type SemanticGraphV1,
  type SemanticPort,
} from "@openadam/graph-projection";
import type { FlowPlacementDirection, FlowSpace } from "../types/mindmap";

function portSide(direction: FlowPlacementDirection): PortSide {
  return direction === "up" ? "top" : direction === "down" ? "bottom" : direction;
}

function semanticPorts(): SemanticPort[] {
  return (["up", "right", "down", "left"] as const).map((id) => ({
    id,
    preferredSide: portSide(id),
  }));
}

export function flowSpaceToSemanticGraph(space: FlowSpace): SemanticGraphV1 {
  const graph: SemanticGraphV1 = {
    version: SEMANTIC_GRAPH_VERSION,
    nodes: Object.values(space.nodes).map((node) => ({
      id: node.id,
      label: node.text,
      kind: node.kind,
      ports: semanticPorts(),
    })),
    relations: space.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      direction: "directed",
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.fromPort === undefined ? {} : { sourcePort: edge.fromPort }),
      ...(edge.toPort === undefined ? {} : { targetPort: edge.toPort }),
    })),
  };
  assertSemanticGraph(graph);
  return graph;
}
