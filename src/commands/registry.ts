export type CommandContext = "selection" | "editing" | "global";

export type CommandId =
  | "node.create-sibling"
  | "node.create-above"
  | "node.create-child"
  | "node.outdent"
  | "node.delete"
  | "node.delete-preserve"
  | "node.parent"
  | "node.child"
  | "node.previous"
  | "node.next"
  | "node.move-up"
  | "node.move-down"
  | "node.toggle"
  | "map.collapse-all"
  | "map.expand-all"
  | "history.undo"
  | "history.redo"
  | "map.copy-markdown"
  | "map.new"
  | "map.search"
  | "map.command-palette"
  | "viewport.fit"
  | "viewport.focus"
  | "viewport.zoom-in"
  | "viewport.zoom-out"
  | "viewport.reset";

export interface CommandDefinition {
  id: CommandId;
  label: string;
  shortcut: string;
  aliases?: string[];
  contexts: CommandContext[];
  group: "节点" | "编辑" | "视图" | "文件";
}

export const commandRegistry: CommandDefinition[] = [
  {
    id: "node.create-sibling",
    label: "创建同级节点",
    shortcut: "Enter",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.create-above",
    label: "创建上方同级节点",
    shortcut: "Shift+Enter",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.create-child",
    label: "创建子节点",
    shortcut: "Tab",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.outdent",
    label: "提升一级",
    shortcut: "Shift+Tab",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.delete",
    label: "删除节点及子节点",
    shortcut: "Backspace",
    aliases: ["Delete"],
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.delete-preserve",
    label: "仅删除当前节点",
    shortcut: "Alt+Backspace",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.parent",
    label: "选择父节点",
    shortcut: "ArrowLeft",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.child",
    label: "选择第一个子节点",
    shortcut: "ArrowRight",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.previous",
    label: "选择上一个同级节点",
    shortcut: "ArrowUp",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.next",
    label: "选择下一个同级节点",
    shortcut: "ArrowDown",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.move-up",
    label: "节点向上移动",
    shortcut: "Meta+ArrowUp",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.move-down",
    label: "节点向下移动",
    shortcut: "Meta+ArrowDown",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "node.toggle",
    label: "折叠或展开节点",
    shortcut: "Meta+/",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "map.collapse-all",
    label: "折叠除根节点外全部分支",
    shortcut: "Alt+Meta+ArrowLeft",
    contexts: ["selection"],
    group: "视图",
  },
  {
    id: "map.expand-all",
    label: "展开全部分支",
    shortcut: "Alt+Meta+ArrowRight",
    contexts: ["selection"],
    group: "视图",
  },
  {
    id: "history.undo",
    label: "撤销",
    shortcut: "Meta+z",
    contexts: ["selection", "global"],
    group: "编辑",
  },
  {
    id: "history.redo",
    label: "重做",
    shortcut: "Shift+Meta+z",
    contexts: ["selection", "global"],
    group: "编辑",
  },
  {
    id: "map.copy-markdown",
    label: "复制为 Markdown",
    shortcut: "Shift+Meta+c",
    contexts: ["selection", "global"],
    group: "文件",
  },
  {
    id: "map.new",
    label: "新建思维导图",
    shortcut: "Meta+n",
    contexts: ["selection", "global"],
    group: "文件",
  },
  {
    id: "map.search",
    label: "搜索节点",
    shortcut: "Meta+f",
    contexts: ["selection", "global"],
    group: "编辑",
  },
  {
    id: "map.command-palette",
    label: "打开命令面板",
    shortcut: "Meta+k",
    contexts: ["selection", "global"],
    group: "编辑",
  },
  {
    id: "viewport.fit",
    label: "画布适应内容",
    shortcut: "Shift+1",
    contexts: ["selection", "global"],
    group: "视图",
  },
  {
    id: "viewport.focus",
    label: "聚焦选中节点",
    shortcut: "Shift+2",
    contexts: ["selection", "global"],
    group: "视图",
  },
  {
    id: "viewport.zoom-in",
    label: "放大",
    shortcut: "Meta+=",
    contexts: ["selection", "global"],
    group: "视图",
  },
  {
    id: "viewport.zoom-out",
    label: "缩小",
    shortcut: "Meta+-",
    contexts: ["selection", "global"],
    group: "视图",
  },
  {
    id: "viewport.reset",
    label: "恢复 100%",
    shortcut: "Meta+0",
    contexts: ["selection", "global"],
    group: "视图",
  },
];

function eventShortcut(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey || event.ctrlKey) parts.push("Meta");
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join("+");
}

export function findCommandForEvent(
  event: KeyboardEvent,
  context: CommandContext,
): CommandDefinition | undefined {
  const shortcut = eventShortcut(event);
  return commandRegistry.find(
    (command) =>
      (command.shortcut === shortcut || command.aliases?.includes(shortcut)) &&
      command.contexts.includes(context),
  );
}

export function isPrintableKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}
