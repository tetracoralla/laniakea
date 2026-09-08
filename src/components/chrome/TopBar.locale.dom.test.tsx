// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import { CommandOverlay } from '../commands/CommandOverlay';
import { MindMapNode } from '../canvas/MindMapNode';
import { MindMapCanvas } from '../canvas/MindMapCanvas';
import { singleSelection } from '../../model/selection';
import { createBlankDocument } from '../../data/seed';
import { computeLayout } from '../../model/layout';
import { getLocale, initializeLanguage, LANGUAGE_KEY, setLanguagePreference } from '../../i18n/locale';

let root: Root;
let container: HTMLDivElement;
let cleanup: () => void;
const action = vi.fn();
const props = {
  title: '未命名节点', onTitleChange: action, onSearch: action, onNew: action,
  onImport: action, onSave: action, onSaveAs: action, onCopyMarkdown: action,
  onShortcutSettings: action, currentDocumentPath: null, recentDocuments: [],
  onOpenRecent: action, onRevealCurrent: action, onRevealRecent: action,
  onCopyDocumentPath: action, onMoveRecent: action, onForgetRecent: action,
  showDesktopActions: false,
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN']);
  localStorage.clear(); action.mockClear(); cleanup = initializeLanguage();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); cleanup(); container.remove();
  setLanguagePreference('zh'); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function openLanguage() {
  const more = container.querySelector<HTMLButtonElement>('.topbar__more-button')
    ?? container.querySelector<HTMLButtonElement>(getLocale() === 'zh' ? '[aria-label="更多"]' : '[aria-label="More"]');
  await act(async () => more!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Language / 语言"]')!.click());
  return more;
}
it('switches through the More menu, retains the document title, supports keyboard selection, and restores focus', async () => {
  await act(async () => root.render(<TopBar {...props} />));
  const title = container.querySelector<HTMLInputElement>('input')!;
  const more = await openLanguage();
  const system = document.querySelector<HTMLButtonElement>('[data-language="system"]')!;
  expect(document.activeElement).toBe(system);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-language="en"]')!.click());
  expect(getLocale()).toBe('en');
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Interface language');
  expect(document.querySelector('[data-language="system"]')?.textContent).toBe('Follow system');
  expect(title.value).toBe('未命名节点');
  expect(title.closest('label')?.textContent).toContain('Document title');
  expect(localStorage.getItem(LANGUAGE_KEY)).toBe('en');
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(more);
  await openLanguage();
  expect(document.activeElement?.getAttribute('data-language')).toBe('en');
  await act(async () => document.querySelector('[role="radiogroup"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })));
  expect(getLocale()).toBe('zh');
  expect(document.activeElement?.getAttribute('data-language')).toBe('system');
  expect(action).not.toHaveBeenCalled();
});

it('tabs through the selected language only and keeps arrow selection consistent with focus', async () => {
  setLanguagePreference('en');
  await act(async () => root.render(<TopBar {...props} />));
  await openLanguage();
  const press = async (key: string, shiftKey = false) => act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, shiftKey }));
  });
  await press('Tab');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close language settings');
  await press('Tab');
  expect(document.activeElement?.getAttribute('data-language')).toBe('en');
  await press('ArrowUp');
  expect(document.activeElement?.getAttribute('data-language')).toBe('zh');
  expect(getLocale()).toBe('zh');
  await press('Tab', true);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭语言设置');
  await press('Tab', true);
  expect(document.activeElement?.getAttribute('data-language')).toBe('zh');
  expect(action).not.toHaveBeenCalled();
});

it('keeps an in-progress composed node edit, caret, and geometry when the system language changes', async () => {
  const map = createBlankDocument();
  const node = map.nodes[map.rootId];
  const layout = computeLayout(map).nodes[map.rootId];
  const commit = vi.fn();
  await act(async () => root.render(<MindMapNode node={node} layout={layout}
    selected primary editing draft="中文 English" onSelect={action} onBeginEdit={action}
    onDraftChange={action} onPasteStructured={() => false} onCommitEdit={commit}
    onCancelEdit={action} onToggle={action} onDragPointerDown={action} />));
  const editor = container.querySelector<HTMLTextAreaElement>('textarea')!;
  const style = editor.closest('.mind-node')!.getAttribute('style');
  editor.setSelectionRange(2, 2);
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  await act(async () => window.dispatchEvent(new Event('languagechange')));
  expect(container.querySelector('textarea')).toBe(editor);
  expect(editor.getAttribute('aria-label')).toBe('Edit node');
  expect(editor.value).toBe('中文 English');
  expect(editor.selectionStart).toBe(2);
  expect(document.activeElement).toBe(editor);
  expect(editor.closest('.mind-node')!.getAttribute('style')).toBe(style);
  await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true })));
  expect(commit).not.toHaveBeenCalled();
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
  expect(commit).toHaveBeenCalledWith(node.id, '中文 English');
});

it('searches translated commands and shows their translated group while retaining node text in search', async () => {
  setLanguagePreference('en');
  const map = createBlankDocument(); map.nodes[map.rootId].text = '未命名节点';
  await act(async () => root.render(<CommandOverlay mode="commands" document={map}
    onClose={action} onExecute={action} onSelectNode={action} />));
  const search = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'fit');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const option = container.querySelector('[role="option"]')!;
  expect(option.textContent).toContain('Fit canvas to content');
  expect(option.querySelector('small')?.textContent).toBe('View');
  await act(async () => root.render(<CommandOverlay mode="search" document={map}
    onClose={action} onExecute={action} onSelectNode={action} />));
  expect(container.querySelector('[role="option"] strong')?.textContent).toBe('未命名节点');
});

it('resizes translated empty placeholders without changing stored content or view state', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const map = createBlankDocument();
  const before = JSON.stringify(map);
  await act(async () => root.render(<MindMapCanvas document={map} selection={singleSelection(map.rootId)}
    editingId={null} draft="" onSelectionChange={action} onBeginEdit={action} onSpaceTap={action}
    onDraftChange={action} onPasteStructured={() => false} onCommitEdit={action} onCancelEdit={action}
    onToggle={action} onAttachNode={action} onDetachNode={action} onViewportChange={action} />));
  const node = container.querySelector<HTMLElement>('.mind-node')!;
  const chineseWidth = node.style.width;
  await act(async () => setLanguagePreference('en'));
  expect(node.textContent).toBe('Central topic');
  expect(node.style.width).toBe(`${computeLayout(map).nodes[map.rootId].width}px`);
  expect(node.style.width).not.toBe(chineseWidth);
  await act(async () => setLanguagePreference('zh'));
  expect(node.textContent).toBe('中心主题');
  expect(node.style.width).toBe(chineseWidth);
  expect(JSON.stringify(map)).toBe(before);
  expect(action).not.toHaveBeenCalled();
});
