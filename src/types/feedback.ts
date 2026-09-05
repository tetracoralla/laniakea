export interface AppNotice {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  persistent?: boolean;
  tone?: "neutral" | "error";
}
