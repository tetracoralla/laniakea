import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import { useEffect, useId, useRef } from "react";
import { trapDialogTab } from "./focus";

interface DeleteSubspaceDialogProps {
  nodeLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  typeLabel: string;
}

export function DeleteSubspaceDialog({
  nodeLabel,
  onCancel,
  onConfirm,
  typeLabel,
}: DeleteSubspaceDialogProps) {
  useLocale();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="delete-subspace-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="delete-subspace-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          trapDialogTab(event, dialogRef);
        }}
        ref={dialogRef}
        role="dialog"
      >
        <h2 id={titleId}>{t("删除这张{0}？", typeLabel)}</h2>
        <p id={descriptionId}>
          {t("“{0}”下的全部内容会被删除，原节点会保留。此操作可撤销。", nodeLabel.trim() || t("未命名节点"))}</p>
        <div className="delete-subspace-dialog__actions">
          <button onClick={onCancel} ref={cancelRef} type="button">
            {t("取消")}</button>
          <button
            className="delete-subspace-dialog__confirm"
            onClick={onConfirm}
            type="button"
          >
            {t("删除")}
          </button>
        </div>
      </section>
    </div>
  );
}
