import { messages, type MessageKey } from './messages';

export type Locale = 'zh' | 'en';
export type LanguagePreference = 'system' | Locale;
export const LANGUAGE_KEY = 'origin.language';
// Shared model callers outside the application keep the original source language.
let locale: Locale = 'zh';
let preference: LanguagePreference = 'system';
const listeners = new Set<() => void>();

export function resolveSystemLanguage(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === 'zh' || base === 'en') return base;
  }
  return 'en';
}

function systemLanguage(): Locale {
  return resolveSystemLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}
function readPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return value === 'zh' || value === 'en' ? value : 'system';
  } catch { return 'system'; }
}
export function getLocale(): Locale { return locale; }
export function getLanguagePreference(): LanguagePreference { return preference; }
export function getLanguageSnapshot(): string { return `${preference}:${locale}`; }
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function applyLanguage(next: LanguagePreference) {
  preference = next;
  locale = next === 'system' ? systemLanguage() : next;
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = `Laniakea · ${t('快速、轻量的思维导图')}`;
  for (const listener of listeners) listener();
}
export function setLanguagePreference(next: LanguagePreference) {
  try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Session choice still works. */ }
  applyLanguage(next);
}
export function initializeLanguage() {
  applyLanguage(readPreference());
  const onSystemChange = () => { if (preference === 'system') applyLanguage('system'); };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LANGUAGE_KEY && event.key !== null) return;
    try { if (event.storageArea !== localStorage) return; } catch { return; }
    applyLanguage(readPreference());
  };
  window.addEventListener('languagechange', onSystemChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('languagechange', onSystemChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function t(key: MessageKey, ...values: Array<string | number>): string {
  const pattern = locale === 'en' ? messages[key] : key;
  return pattern.replace(/\{(\d+)\}/g, (token, index) => String(values[Number(index)] ?? token));
}

/** Localize a known product label, or a stored/native product message at its
 * display boundary. Never use this for node text, document titles or paths.
 * Substituted user text is kept verbatim; it is not recursively translated. */
const entries = Object.entries(messages);
const sourceKeys = new Set(entries.map(([key]) => key));
const englishKeys = new Map(entries.map(([key, value]) => [value, key]));
function compileTemplates(language: Locale) {
  return entries.filter(([key]) => /\{\d+\}/.test(key)).map(([key, english]) => {
    const pattern = language === 'zh' ? key : english;
    const indices: number[] = [];
    const source = pattern.split(/(\{\d+\})/g).map(segment => {
      const match = /^\{(\d+)\}$/.exec(segment);
      if (match) { indices.push(Number(match[1])); return '([\\s\\S]*?)'; }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { key, regex: new RegExp(`^${source}$`), indices,
      specificity: pattern.replace(/\{\d+\}/g, '').length };
  }).sort((a, b) => b.specificity - a.specificity);
}
const templates = { zh: compileTemplates('zh'), en: compileTemplates('en') };
const nestedErrorMessages = new Set<string>([
  '无法保存：{0}。当前内容仍保留，请另存副本。',
  '无法完整创建本地草稿: {0}',
  '目标文件已写入但配套状态不完整，原草稿仍保留: {0}',
  '临时恢复记录无法读取，原始记录已保留：{0}',
  '编辑恢复草稿无法读取，原始记录已保留：{0}',
]);
export function localizeMessage(text: string, errorDepth = 0): string {
  if (sourceKeys.has(text)) return t(text as MessageKey);
  const source = englishKeys.get(text as typeof messages[MessageKey]);
  if (source) return t(source as MessageKey);
  if (text.length > 16_384) return text;
  for (const entry of templates[locale === 'en' ? 'zh' : 'en']) {
    const match = entry.regex.exec(text);
    if (!match) continue;
    const values: string[] = [];
    entry.indices.forEach((index, capture) => { values[index] = match[capture + 1]; });
    // These explicitly identified slots contain product errors, never user text.
    if (nestedErrorMessages.has(entry.key) && errorDepth < 3) {
      values[0] = localizeMessage(values[0], errorDepth + 1);
    }
    return t(entry.key as MessageKey, ...values);
  }
  // Native storage errors append OS details to a known action. Translate only
  // that action, keeping paths and diagnostic details exactly as received.
  const separator = text.indexOf(': ');
  if (separator > 0) {
    const prefix = text.slice(0, separator);
    const key = sourceKeys.has(prefix) ? prefix : englishKeys.get(prefix as typeof messages[MessageKey]);
    if (key) return `${t(key as MessageKey)}${text.slice(separator)}`;
  }
  return text;
}
