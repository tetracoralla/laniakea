export type BranchTone = "violet" | "blue" | "emerald" | "amber";

export interface MindNode {
  id: string;
  text: string;
  parentId: string | null;
  children: string[];
  subspaceId?: string;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FloatingRoot {
  id: string;
  x: number;
  y: number;
}

export type FlowNodeKind = "start" | "step" | "decision" | "end";

export interface FlowNode {
  id: string;
  text: string;
  kind: FlowNodeKind;
  createdAt: string;
  updatedAt: string;
}

export interface FlowNodePosition {
  x: number;
  y: number;
}

export type FlowPlacementDirection = "up" | "right" | "down" | "left";

export type FlowConnectorKind = "rounded" | "orthogonal" | "straight" | "curved";
export type FlowConnectorDash = "solid" | "dashed" | "dotted";
export type FlowConnectorWeight = "thin" | "regular" | "bold";
export type FlowConnectorEndpoint = "none" | "arrow" | "dot" | "ring";
export type FlowConnectorTone = "neutral" | "violet" | "blue" | "emerald" | "amber";

export interface FlowEdgeStyle {
  kind?: FlowConnectorKind;
  dash?: FlowConnectorDash;
  weight?: FlowConnectorWeight;
  sourceEndpoint?: FlowConnectorEndpoint;
  targetEndpoint?: FlowConnectorEndpoint;
  tone?: FlowConnectorTone;
}

export interface FlowEdgeRouteOverride {
  /** The movable central corridor is either a fixed x or a fixed y line. */
  axis: "x" | "y";
  coordinate: number;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  fromPort?: FlowPlacementDirection;
  toPort?: FlowPlacementDirection;
  style?: FlowEdgeStyle;
}

export interface FlowSpace {
  id: string;
  type: "flow";
  anchorNodeId: string;
  nodes: Record<string, FlowNode>;
  edges: FlowEdge[];
  /**
   * Human canvas arrangement. It is persisted with local view state but is
   * deliberately omitted from the portable Markdown space bundle.
   */
  positions?: Record<string, FlowNodePosition>;
  /**
   * Human-adjusted connector corridors. Like node positions, these are local
   * canvas arrangement and are omitted from the portable Markdown bundle.
   */
  edgeRoutes?: Record<string, FlowEdgeRouteOverride>;
  /** Label displacement from the route midpoint, in canvas coordinates. */
  edgeLabelOffsets?: Record<string, FlowNodePosition>;
  viewport: Viewport;
  updatedAt: string;
}

export interface MapSpace {
  id: string;
  type: "map";
  anchorNodeId: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  floatingRoots: FloatingRoot[];
  viewport: Viewport;
  updatedAt: string;
}

export type LaniakeaSpace = MapSpace | FlowSpace;

export interface MindMapDocument {
  formatVersion: 1;
  title: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  floatingRoots: FloatingRoot[];
  /**
   * Optional so existing formatVersion 1 browser records and recovery files
   * remain valid. Portable space content is serialized into the reserved
   * Laniakea Markdown block; view state remains in the local document cache.
   */
  spaces?: Record<string, LaniakeaSpace>;
  viewport: Viewport;
  updatedAt: string;
}

export interface SelectionState {
  primaryId: string | null;
  selectedIds: string[];
}

export interface EditorSnapshot {
  document: MindMapDocument;
  selection: SelectionState;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  tone: BranchTone;
  rootKind: "main" | "floating" | null;
}

export interface LayoutResult {
  nodes: Record<string, LayoutNode>;
  /** Visual proxies for anchored subspaces, keyed by their anchor node id. */
  portals?: Record<string, LayoutNode>;
  visibleIds: string[];
  width: number;
  height: number;
}

export type SaveState = "loading" | "saved" | "saving" | "error";

export type StartupMode = "loading" | "fresh" | "restored";
