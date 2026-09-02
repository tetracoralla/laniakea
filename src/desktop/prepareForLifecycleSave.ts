const lifecycleEditableSelector = [
  ".document-title input",
  ".mind-node__editor",
  ".flow-node__editor",
  ".flow-edge-label__editor",
].join(", ");

/**
 * Commit editable fields before a native close or application quit save.
 *
 * On macOS the webview can lose focus before Tauri delivers ExitRequested.
 * Calling blur() at that point is a no-op, even though React still has an
 * editor mounted with newer DOM text. Dispatching the bubbling focusout event
 * for those remaining editors reaches React's onBlur handlers and commits the
 * value synchronously inside the caller's flushSync boundary.
 */
export function prepareEditableFieldsForLifecycleSave(
  ownerDocument: Document = globalThis.document,
): void {
  const activeElement = ownerDocument.activeElement;
  const editableFields = Array.from(
    ownerDocument.querySelectorAll<HTMLElement>(lifecycleEditableSelector),
  );

  if (activeElement instanceof HTMLElement) activeElement.blur();

  const FocusEventConstructor =
    ownerDocument.defaultView?.FocusEvent ?? globalThis.FocusEvent;
  editableFields.forEach((field) => {
    if (field === activeElement || !field.isConnected) return;
    field.dispatchEvent(new FocusEventConstructor("focusout", {
      bubbles: true,
      relatedTarget: null,
    }));
  });
}
