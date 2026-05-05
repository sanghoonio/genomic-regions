// Floating chip overlays for UMAP plots, mirroring bedbase-ui's sidebar
// chip pattern: opaque base-100 outer rounded box with tinted inner row.
// Used as legend overlays (color swatches) inside each UMAP card body.

import { Pin } from 'lucide-react';
import type { ReactNode } from 'react';

export type LegendItem = { label: string; color: string };

export function UMAPGradientChip({
  palette,
  leftLabel,
  rightLabel,
}: {
  palette: ReadonlyArray<string>;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[10px] leading-tight font-medium bg-base-100 rounded-md border border-base-300 shadow-sm px-2 py-1">
      <span className="text-base-content/80 font-normal">{leftLabel}</span>
      <span
        className="inline-block h-2 w-20 rounded-sm border border-base-300/50"
        style={{
          background: `linear-gradient(to right, ${palette.join(', ')})`,
        }}
      />
      <span className="text-base-content/80 font-normal">{rightLabel}</span>
    </div>
  );
}

export function UMAPTextChip({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[10px] leading-tight font-medium bg-base-100 rounded-md border border-base-300 shadow-sm px-2 py-1">
      <span className="text-base-content/80 font-normal">{label}</span>
    </div>
  );
}

export function UMAPLegendChip({
  items,
  trailing,
  pinned,
  onTogglePin,
  orientation = 'vertical',
}: {
  items: ReadonlyArray<LegendItem>;
  trailing?: ReactNode;
  /** When provided, each item becomes a button that toggles its membership
   * in this set. Pinned items pick up a primary tint + filled pin icon. */
  pinned?: ReadonlySet<string>;
  onTogglePin?: (label: string) => void;
  /** Layout direction. Default `vertical` (one row per entry) suits the
   * UMAP overlay; `horizontal` is used for the Section 1 legend that sits
   * inline with caption text. */
  orientation?: 'vertical' | 'horizontal';
}) {
  const interactive = !!onTogglePin;
  const layoutCls =
    orientation === 'horizontal'
      ? 'flex-wrap items-center gap-x-2 gap-y-1 px-2'
      : 'flex-col items-stretch gap-y-0.5 px-1.5';
  return (
    <div
      className={`inline-flex ${layoutCls} text-[10px] leading-tight font-medium bg-base-100 rounded-md border border-base-300 shadow-sm py-1`}
    >
      {items.map((it) => {
        const isPinned = pinned?.has(it.label) ?? false;
        const Tag = interactive ? 'button' : 'span';
        return (
          <Tag
            key={it.label}
            type={interactive ? 'button' : undefined}
            onClick={
              interactive ? () => onTogglePin?.(it.label) : undefined
            }
            className={`inline-flex items-center gap-1 px-1 py-[1px] rounded transition-colors ${
              interactive ? 'cursor-pointer' : ''
            } ${
              isPinned
                ? 'bg-primary/15 text-primary'
                : interactive
                  ? 'hover:bg-base-200'
                  : ''
            }`}
          >
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0"
              // Color is data-driven — has to be inline.
              style={{ backgroundColor: it.color }}
            />
            <span
              className={
                isPinned ? 'text-primary' : 'text-base-content/80 font-normal'
              }
            >
              {it.label}
            </span>
            {isPinned && (
              <Pin size={9} fill="currentColor" className="text-primary" />
            )}
          </Tag>
        );
      })}
      {trailing}
    </div>
  );
}

// Generic header card wrapper used to frame each UMAP. Mirrors bedbase-ui's
// embedding-selections sidebar card: rounded outer, base-200 header strip
// with bold title + optional muted suffix, then the children below.
export function UMAPCard({
  title,
  suffix,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  /** Muted text rendered after the bold title (e.g., a count). */
  suffix?: ReactNode;
  /** Optional right-aligned slot in the header (e.g., a toggle). */
  actions?: ReactNode;
  children: ReactNode;
  /** Extra classes appended to the outer card container — useful for
   * `flex-1 min-h-0` when the card lives in a height-constrained flex
   * column. */
  className?: string;
}) {
  return (
    <div
      // overflow-visible on the outer card so dropdowns from header
      // buttons (ColorByPicker, FilterButton, …) can escape the box
      // instead of getting clipped by the card edge / hidden under the
      // UMAP canvas's stacking context.
      className={`border border-base-300 rounded-lg bg-base-100 flex flex-col ${className}`}
    >
      <div className="relative z-30 px-3 py-2 border-b border-base-300 bg-base-200 rounded-t-lg flex items-center justify-between gap-3 shrink-0">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-xs font-bold truncate">{title}</span>
          {suffix && (
            <span className="text-xs font-normal text-base-content/50">
              {suffix}
            </span>
          )}
        </span>
        {actions && (
          // Absolute-positioned so the buttons can't push the row's
          // intrinsic height — header height is determined purely by
          // the title regardless of whether actions are present.
          <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 shrink-0">
            {actions}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
