export type BranchTone = "violet" | "blue" | "emerald" | "amber";

export interface MindNode {
  id: string;
  text: string;
  parentId: string | null;
  children: string[];
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface MindMapDocument {
  formatVersion: 1;
  title: string;
  rootId: string;
  nodes: Record<string, MindNode>;
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
}

export interface LayoutResult {
  nodes: Record<string, LayoutNode>;
  visibleIds: string[];
  width: number;
  height: number;
}

export type SaveState = "loading" | "saved" | "saving" | "error";

export type StartupMode = "loading" | "fresh" | "restored";
