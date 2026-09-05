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
  if (total <= count) return null;
  return (
    <div className="result-pagination">
      <span role="status">{start + 1}–{start + count} / {total}</span>
      <div>
        <button
          aria-label="上一页结果"
          disabled={start === 0}
          onClick={onPrevious}
          type="button"
        >上一页</button>
        <button
          aria-label="下一页结果"
          disabled={start + count >= total}
          onClick={onNext}
          type="button"
        >下一页</button>
      </div>
    </div>
  );
}
