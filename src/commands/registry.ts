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
  | "selection.extend-parent"
  | "selection.extend-child"
  | "selection.extend-previous"
  | "selection.extend-next"
  | "selection.select-all"
  | "selection.clear"
  | "node.copy"
  | "node.cut"
  | "node.paste"
  | "node.move-up"
  | "node.move-down"
  | "node.toggle"
  | "map.collapse-all"
  | "map.expand-all"
  | "history.undo"
  | "history.redo"
  | "map.copy-markdown"
  | "map.new"
  | "map.open"
  | "map.save"
  | "map.save-as"
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
    aliases: ["Alt+Delete"],
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
    id: "selection.extend-parent",
    label: "向父节点扩展选择",
    shortcut: "Shift+ArrowLeft",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "selection.extend-child",
    label: "向子节点扩展选择",
    shortcut: "Shift+ArrowRight",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "selection.extend-previous",
    label: "向上扩展选择",
    shortcut: "Shift+ArrowUp",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "selection.extend-next",
    label: "向下扩展选择",
    shortcut: "Shift+ArrowDown",
    contexts: ["selection"],
    group: "节点",
  },
  {
    id: "selection.select-all",
    label: "选择全部可见节点",
    shortcut: "Meta+a",
    contexts: ["selection"],
    group: "编辑",
  },
  {
    id: "selection.clear",
    label: "清除选择",
    shortcut: "Escape",
    aliases: ["Shift+Meta+a"],
    contexts: ["selection"],
    group: "编辑",
  },
  {
    id: "node.copy",
    label: "复制选中节点",
    shortcut: "Meta+c",
    contexts: ["selection"],
    group: "编辑",
  },
  {
    id: "node.cut",
    label: "剪切选中节点",
    shortcut: "Meta+x",
    contexts: ["selection"],
    group: "编辑",
  },
  {
    id: "node.paste",
    label: "粘贴为子节点",
    shortcut: "Meta+v",
    contexts: ["selection"],
    group: "编辑",
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
    id: "map.open",
    label: "打开文件",
    shortcut: "Meta+o",
    contexts: ["selection", "global"],
    group: "文件",
  },
  {
    id: "map.save",
    label: "立即保存",
    shortcut: "Meta+s",
    contexts: ["selection", "global"],
    group: "文件",
  },
  {
    id: "map.save-as",
    label: "另存为 Markdown",
    shortcut: "Shift+Meta+s",
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
  const commandModifier = event.metaKey || event.ctrlKey;
  const shiftedEqual =
    commandModifier &&
    (event.code === "Equal" || event.key === "+");
  if (event.shiftKey && !shiftedEqual) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (commandModifier) parts.push("Meta");

  let key = event.key;
  if (event.shiftKey && event.code?.startsWith("Digit")) {
    key = event.code.slice("Digit".length);
  } else if (shiftedEqual) {
    key = "=";
  }
  parts.push(key.length === 1 ? key.toLowerCase() : key);
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
