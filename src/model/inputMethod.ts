interface NativeCompositionKey {
  isComposing?: boolean;
  keyCode?: number;
}

export function isInputMethodKey(
  nativeEvent: NativeCompositionKey,
  activeComposition = false,
): boolean {
  return Boolean(
    activeComposition ||
    nativeEvent.isComposing ||
    nativeEvent.keyCode === 229
  );
}

export function markInputMethodComposition(
  editor: HTMLInputElement | HTMLTextAreaElement,
  composing: boolean,
): void {
  if (composing) editor.dataset.composing = "true";
  else delete editor.dataset.composing;
}

export function hasInputMethodComposition(
  editor: Element | null,
): boolean {
  return editor instanceof HTMLElement && editor.dataset.composing === "true";
}
