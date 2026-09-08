import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
interface ResultPaginationProps {
  start: number;
  count: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function ResultPagination({
  start,
  count,
  total,
  onPrevious,
  onNext,
}: ResultPaginationProps) {
  useLocale();
  if (total <= count) return null;
  return (
    <div className="result-pagination">
      <span role="status">{start + 1}–{start + count} / {total}</span>
      <div>
        <button
          aria-label={t("上一页结果")}
          disabled={start === 0}
          onClick={onPrevious}
          type="button"
        >{t("上一页")}</button>
        <button
          aria-label={t("下一页结果")}
          disabled={start + count >= total}
          onClick={onNext}
          type="button"
        >{t("下一页")}</button>
      </div>
    </div>
  );
}
