import { useEffect, useState } from "react";

/** Keep rendering bounded without making later matches unreachable. */
export function usePagedResults<T>(items: T[], pageSize: number) {
  const [selection, setSelection] = useState({ items, index: 0 });
  const activeIndex = selection.items === items
    ? Math.min(selection.index, Math.max(0, items.length - 1))
    : 0;
  const pageStart = Math.floor(activeIndex / pageSize) * pageSize;
  const visibleItems = items.slice(pageStart, pageStart + pageSize);
  const select = (index: number) => setSelection((current) => {
    const nextIndex = Math.max(0, Math.min(items.length - 1, index));
    return current.items === items && current.index === nextIndex
      ? current
      : { items, index: nextIndex };
  });
  const move = (delta: number) => setSelection((current) => ({
    items,
    index: Math.max(0, Math.min(items.length - 1,
      (current.items === items ? current.index : 0) + delta)),
  }));

  return {
    activeIndex,
    activeItem: items[activeIndex],
    pageStart,
    visibleItems,
    total: items.length,
    select,
    move,
    previousPage: () => select(pageStart - pageSize),
    nextPage: () => select(pageStart + pageSize),
  };
}

/** aria-activedescendant alone does not scroll its option into view. */
export function useRevealActiveOption(id: string | undefined, items: readonly unknown[]) {
  useEffect(() => {
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: "nearest" });
  }, [id, items]);
}
