export interface AppNotice {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "error";
}
