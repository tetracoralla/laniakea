import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  displayGlobalShortcut,
  shortcutFromKeyboardEvent,
} from "../../desktop/shortcut";
import { trapDialogTab } from "../overlays/focus";

interface ShortcutSettingsProps {
  currentShortcut: string;
  registered: boolean;
  onClose: () => void;
  onSave: (shortcut: string) => Promise<boolean>;
}

export function ShortcutSettings({
  currentShortcut,
  registered,
  onClose,
  onSave,
}: ShortcutSettingsProps) {
  const [candidate, setCandidate] = useState(currentShortcut);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const recorderRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    recorderRef.current?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      if (recording) {
        setRecording(false);
        setError(null);
      } else {
        onClose();
      }
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) {
      if (!["Alt", "Control", "Meta", "Shift"].includes(event.key)) {
        setError("请同时按住 ⌘、⌃ 或 ⌥");
      }
      return;
    }
    setCandidate(shortcut);
    setRecording(false);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const saved = await onSave(candidate);
    setSaving(false);
    if (saved) onClose();
    else setError("快捷键未生效，请换一个组合");
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    trapDialogTab(event, dialogRef);
  };

  return (
    <div
      className="settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="shortcut-settings-title"
        aria-modal="true"
        className="shortcut-settings"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="shortcut-settings__heading">
          <h2 id="shortcut-settings-title">唤醒快捷键</h2>
          <span className={registered ? "is-ready" : "is-conflict"}>
            {registered ? "当前可用" : "当前组合被占用"}
          </span>
        </div>
        <p>在其他应用中按下这个组合，即可立即唤醒 Laniakea。</p>
        <button
          className={`shortcut-recorder ${recording ? "is-recording" : ""}`}
          onClick={() => {
            setRecording(true);
            setError(null);
          }}
          onKeyDown={recording ? handleKeyDown : undefined}
          ref={recorderRef}
          type="button"
        >
          {recording
            ? "请按下新的组合…"
            : displayGlobalShortcut(candidate)}
        </button>
        <span aria-live="polite" className="shortcut-settings__error">
          {error ?? ""}
        </span>
        <div className="shortcut-settings__actions">
          <button onClick={onClose} type="button">
            取消
          </button>
          <button
            className="is-primary"
            disabled={
              saving || (registered && candidate === currentShortcut)
            }
            onClick={() => void save()}
            type="button"
          >
            {saving ? "正在应用" : "应用"}
          </button>
        </div>
      </section>
    </div>
  );
}
