import { useEffect, useRef } from 'react';
import { getLanguagePreference, setLanguagePreference, t, type LanguagePreference } from '../../i18n/locale';
import { useLocale } from '../../i18n/useLocale';
import { trapDialogTab } from '../overlays/focus';
import { Icon } from '../icons/Icon';

export function LanguageSettings({ onClose }: { onClose: () => void }) {
  useLocale();
  const selected = getLanguagePreference();
  const dialogRef = useRef<HTMLElement>(null);
  const choices: Array<{ value: LanguagePreference; label: string }> = [
    { value: 'system', label: t('跟随系统') },
    { value: 'zh', label: '简体中文' },
    { value: 'en', label: 'English' },
  ];
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, []);
  return (
    <div className="language-settings-backdrop" onPointerDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="language-settings" aria-label={t('界面语言')} aria-modal="true"
        role="dialog" ref={dialogRef} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
          trapDialogTab(event, dialogRef);
        }}>
        <header>
          <h2>Language / 语言</h2>
          <button type="button" aria-label={t('关闭语言设置')} onClick={onClose}>
            <Icon name="close" size={17} />
          </button>
        </header>
        <div role="radiogroup" aria-label={t('界面语言')} onKeyDown={event => {
          const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1
            : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
          if (!direction) return;
          event.preventDefault();
          const index = choices.findIndex(choice => choice.value === selected);
          const next = choices[(index + direction + choices.length) % choices.length];
          setLanguagePreference(next.value);
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-language="${next.value}"]`)?.focus();
        }}>
          {choices.map(choice => (
            <button key={choice.value} type="button" role="radio" data-language={choice.value}
              aria-checked={selected === choice.value} tabIndex={selected === choice.value ? 0 : -1}
              onClick={() => setLanguagePreference(choice.value)}>
              <span>{choice.label}</span>
              {selected === choice.value && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
