import { Icon } from "../icons/Icon";

interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Toast({ message, actionLabel, onAction }: ToastProps) {
  return (
    <div className="toast" role="status">
      <span className="toast__icon">
        <Icon name="check" size={16} />
      </span>
      <span>{message}</span>
      {actionLabel && onAction && (
        <button onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
