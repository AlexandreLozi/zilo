/**
 * Reference-counted page scroll lock for modal dialogs. The first lock stores the page's inline
 * `overflow` and `padding-inline-end`, hides overflow and pads by the scrollbar width so the page does
 * not shift; the last unlock restores both.
 */
let locks = 0;
let saved: { overflow: string; padding: string } | null = null;

export function lockScroll(doc: Document = document): void {
  locks += 1;
  if (locks > 1) return;
  const html = doc.documentElement;
  const scrollbar = (doc.defaultView?.innerWidth ?? html.clientWidth) - html.clientWidth;
  saved = { overflow: html.style.overflow, padding: html.style.paddingInlineEnd };
  html.style.overflow = 'hidden';
  if (scrollbar > 0) html.style.paddingInlineEnd = `${String(scrollbar)}px`;
}

export function unlockScroll(doc: Document = document): void {
  if (locks === 0) return;
  locks -= 1;
  if (locks > 0 || saved === null) return;
  const html = doc.documentElement;
  html.style.overflow = saved.overflow;
  html.style.paddingInlineEnd = saved.padding;
  saved = null;
}

/** Active lock count (for tests). */
export function scrollLockCount(): number {
  return locks;
}
