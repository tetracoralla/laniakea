import type { MindMapDocument, MindNode } from "../types/mindmap";

const stamp = "2026-07-23T08:00:00.000Z";

function node(
  id: string,
  text: string,
  parentId: string | null,
  children: string[] = [],
): MindNode {
  return {
    id,
    text,
    parentId,
    children,
    collapsed: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function createSeedDocument(): MindMapDocument {
  const nodes: Record<string, MindNode> = {
    root: node("root", "做一个思维导图 APP", null, [
      "scenario",
      "experience",
      "path",
      "boundary",
    ]),
    scenario: node("scenario", "使用场景", "root", [
      "scenario-1",
      "scenario-2",
      "scenario-3",
    ]),
    "scenario-1": node("scenario-1", "接到新需求", "scenario"),
    "scenario-2": node("scenario-2", "先定原点", "scenario"),
    "scenario-3": node("scenario-3", "快速铺开方案", "scenario"),
    experience: node("experience", "核心体验", "root", [
      "experience-1",
      "experience-2",
      "experience-3",
    ]),
    "experience-1": node("experience-1", "打开即输入", "experience"),
    "experience-2": node("experience-2", "全程键盘操作", "experience"),
    "experience-3": node("experience-3", "本地且私密", "experience"),
    path: node("path", "实现路径", "root", ["path-1", "path-2", "path-3"]),
    "path-1": node("path-1", "稳定自动布局", "path"),
    "path-2": node("path-2", "Markdown 导出", "path"),
    "path-3": node("path-3", "性能验证", "path"),
    boundary: node("boundary", "第一版边界", "root", [
      "boundary-1",
      "boundary-2",
      "boundary-3",
    ]),
    "boundary-1": node("boundary-1", "不做协作", "boundary"),
    "boundary-2": node("boundary-2", "不做账号", "boundary"),
    "boundary-3": node("boundary-3", "不做 AI", "boundary"),
  };

  return {
    formatVersion: 1,
    title: "思维导图工具",
    rootId: "root",
    nodes,
    floatingRoots: [],
    viewport: { x: 96, y: -24, zoom: 1 },
    updatedAt: stamp,
  };
}

export function createBlankDocument(): MindMapDocument {
  const now = new Date().toISOString();
  return {
    formatVersion: 1,
    title: "未命名思维",
    rootId: "root",
    nodes: {
      root: {
        id: "root",
        text: "",
        parentId: null,
        children: [],
        collapsed: false,
        createdAt: now,
        updatedAt: now,
      },
    },
    floatingRoots: [],
    viewport: { x: 96, y: 0, zoom: 1 },
    updatedAt: now,
  };
}
