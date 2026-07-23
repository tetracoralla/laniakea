interface KeyboardHintsProps {
  selectionCount: number;
}

export function KeyboardHints({ selectionCount }: KeyboardHintsProps) {
  if (selectionCount > 1) {
    return (
      <div className="keyboard-hints" aria-hidden="true">
        <span className="keyboard-hints__count">
          已选择 {selectionCount} 个节点
        </span>
        <span>
          <kbd>Delete</kbd> 删除
        </span>
        <span>
          <kbd>⇧点击</kbd> 增减
        </span>
      </div>
    );
  }

  return (
    <div className="keyboard-hints" aria-hidden="true">
      <span>
        <kbd>Tab</kbd> 子节点
      </span>
      <span>
        <kbd>Enter</kbd> 同级
      </span>
      <span>
        <kbd>⌘K</kbd> 命令
      </span>
    </div>
  );
}
