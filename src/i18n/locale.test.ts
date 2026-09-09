// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankDocument } from '../data/seed';
import { addFlowBranch, addFlowNodeAtPosition, createFlowSpace } from '../model/spaces';
import { resolveProvisionalDocumentTitle } from '../model/document';
import { clipboardTextToForest } from '../model/clipboard';
import { computeLayout } from '../model/layout';
import { createLocalizedBlankDocument, localizedFlowLabels } from './defaults';
import { messages } from './messages';
import { getLanguagePreference, getLocale, initializeLanguage, LANGUAGE_KEY, localizeMessage,
  resolveSystemLanguage, setLanguagePreference, t } from './locale';

let cleanup: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN']);
  cleanup = initializeLanguage();
});
afterEach(() => { cleanup?.(); setLanguagePreference('zh'); vi.restoreAllMocks(); localStorage.clear(); });

describe('system language and saved choice', () => {
  it('uses the first supported preferred language and English for unsupported languages', () => {
    expect(resolveSystemLanguage(['zh-Hant-TW', 'en-US'])).toBe('zh');
    expect(resolveSystemLanguage(['en-GB', 'zh-CN'])).toBe('en');
    expect(resolveSystemLanguage(['fr-FR', 'zh_CN'])).toBe('zh');
    expect(resolveSystemLanguage(['ja-JP'])).toBe('en');
    expect(resolveSystemLanguage([])).toBe('en');
  });
  it('follows live system changes until overridden, remembers that choice, and resumes following', () => {
    expect(getLanguagePreference()).toBe('system');
    expect(getLocale()).toBe('zh');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    window.dispatchEvent(new Event('languagechange'));
    expect(getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    setLanguagePreference('zh');
    window.dispatchEvent(new Event('languagechange'));
    expect(getLocale()).toBe('zh');
    cleanup?.(); cleanup = initializeLanguage();
    expect(getLanguagePreference()).toBe('zh');
    setLanguagePreference('system');
    expect(getLocale()).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('system');
  });
  it('accepts other windows choices but ignores document and session-storage changes', () => {
    localStorage.setItem(LANGUAGE_KEY, 'en');
    window.dispatchEvent(new StorageEvent('storage', { key: 'origin.document', storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_KEY, storageArea: sessionStorage }));
    expect(getLocale()).toBe('zh');
    window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_KEY, storageArea: localStorage }));
    expect(getLocale()).toBe('en');
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    expect(getLocale()).toBe('zh');
    expect(getLanguagePreference()).toBe('system');
  });
  it('keeps the interface usable when storing preferences is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    cleanup?.(); cleanup = initializeLanguage();
    setLanguagePreference('en');
    expect(t('新建')).toBe('New');
  });
});

describe('message and document boundaries', () => {
  it('preserves every interpolation slot in the catalog', () => {
    const slots = (s: string) => [...s.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
    for (const [source, english] of Object.entries(messages)) {
      expect(english.trim(), source).not.toBe('');
      expect(slots(english), source).toEqual(slots(source));
    }
  });
  it('translates retained messages both ways without translating their user content', () => {
    setLanguagePreference('en');
    const path = '/Users/用户/未命名节点: report.md';
    const english = localizeMessage(`正在保存到：${path}`);
    expect(english).toBe(`Saving to: ${path}`);
    expect(localizeMessage(`无法读取 Markdown 文件: ${path}`)).toBe(`Unable to read the Markdown file: ${path}`);
    expect(localizeMessage(`无法保存：无法读取 Markdown 文件: ${path}。当前内容仍保留，请另存副本。`)).toBe(`Unable to save: Unable to read the Markdown file: ${path}. Your content is still available. Save a copy.`);
    setLanguagePreference('zh');
    expect(localizeMessage(english)).toBe(`正在保存到：${path}`);
    expect(localizeMessage('Unable to read the Markdown file: ENOENT')).toBe('无法读取 Markdown 文件: ENOENT');
    expect(localizeMessage('Unknown diagnostic')).toBe('Unknown diagnostic');
  });
  it('localizes only defaults for newly created human documents and flows', () => {
    setLanguagePreference('en');
    const doc = createLocalizedBlankDocument();
    expect(doc.title).toBe('Untitled mind map');
    expect(createBlankDocument().title).toBe('未命名思维');
    doc.nodes[doc.rootId].text = '未命名节点';
    expect(resolveProvisionalDocumentTitle(doc).title).toBe('未命名节点');
    const before = JSON.stringify(doc);
    const geometry = computeLayout(doc);
    const created = createFlowSpace(doc, doc.rootId);
    const space = created.document.spaces![created.spaceId];
    if (space.type !== 'flow') throw Error('Expected a flow');
    const first = addFlowNodeAtPosition(space, "decision", { x: 0, y: 0 }, {});
    const branch = addFlowBranch(first.space, first.nodeId, localizedFlowLabels());
    expect(branch.space.edges.map(edge => edge.label)).toContain('Yes');
    expect(branch.space.edges.map(edge => edge.label)).toContain('No');
    const existingFlow = JSON.stringify(branch.space);
    setLanguagePreference('zh');
    expect(JSON.stringify(doc)).toBe(before);
    expect(JSON.stringify(branch.space)).toBe(existingFlow);
    expect(computeLayout(doc)).toEqual(geometry);
    expect(resolveProvisionalDocumentTitle(doc).title).toBe('未命名节点');
  });
  it('uses an explicit paste title without changing pasted text or the shared default', () => {
    setLanguagePreference('en');
    const pasted = clipboardTextToForest('- 新建\n- 未命名节点', t('粘贴内容'));
    expect(Object.values(pasted.document.nodes).some(node => node.text === '新建')).toBe(true);
    expect(pasted.document.title).not.toBe('粘贴内容');
    expect(clipboardTextToForest('未命名节点').document.title).toBe('未命名节点');
  });
});
