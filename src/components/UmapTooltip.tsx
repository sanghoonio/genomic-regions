// Shared CustomTooltip class for embedding-atlas's `EmbeddingViewMosaic`
// — drops the library's default tooltip in favour of one styled to
// match the chr-dist and dict-panel hover tooltips elsewhere in the
// app. Pattern adapted from bedbase-ui's AtlasTooltip: each instance
// owns a React root mounted into the target node embedding-atlas
// supplies, and `update()` re-renders that root with the latest
// hovered point's fields.

import { createRoot, type Root } from 'react-dom/client';
import { SCREEN_CLASS_COLORS } from '../lib/colors';

type TooltipPoint = {
  text?: string;
  identifier?: string | number | bigint;
  category?: number;
  x?: number;
  y?: number;
  fields?: Record<string, string | number | null | undefined>;
};

type Props = {
  tooltip?: TooltipPoint | null;
  /** Caller-supplied label that names the identifier column (e.g.
   * "file id" or "token"). Optional. */
  identifierLabel?: string;
  /** Optional ordered list of (label, value) to override the default
   * "all fields, in insertion order" rendering with a curated set. */
  rows?: { label: string; value: string }[];
};

function TooltipBody({ tooltip, identifierLabel }: Props) {
  if (!tooltip) return null;
  const fields = tooltip.fields ?? {};
  const fieldEntries = Object.entries(fields).filter(
    ([, v]) => v != null && v !== '' && v !== 'UNKNOWN',
  );
  return (
    <div
      className="bg-base-100 border border-base-300 rounded-md shadow-md px-2 py-1.5 text-[11px] leading-snug text-base-content"
      style={{ maxWidth: '260px' }}
    >
      {tooltip.text && (
        <div className="font-semibold line-clamp-2">{tooltip.text}</div>
      )}
      {tooltip.identifier != null && (
        <div className="font-mono text-base-content/55 truncate">
          {identifierLabel ? (
            <>
              <span className="text-base-content/45">{identifierLabel}</span>{' '}
              {String(tooltip.identifier)}
            </>
          ) : (
            String(tooltip.identifier)
          )}
        </div>
      )}
      {fieldEntries.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          {fieldEntries.map(([key, val]) => {
            // Render the SCREEN class as a colored pill so the
            // tooltip carries the same visual key as the legend
            // and partner chips.
            const screenColor =
              key === 'class' && typeof val === 'string'
                ? SCREEN_CLASS_COLORS[val]
                : undefined;
            return (
              <div key={key}>
                <span className="text-base-content/45">{key}</span>{' '}
                {screenColor ? (
                  <span
                    className="inline-block px-1.5 rounded-full text-[10px] font-semibold text-white align-baseline"
                    style={{ backgroundColor: screenColor }}
                  >
                    {val}
                  </span>
                ) : (
                  <span>
                    {typeof val === 'number'
                      ? val.toLocaleString()
                      : String(val)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export class UmapTooltip {
  private root: Root;
  constructor(target: HTMLElement, props: Props) {
    this.root = createRoot(target);
    this.root.render(<TooltipBody {...props} />);
  }
  update(props: Props) {
    this.root.render(<TooltipBody {...props} />);
  }
  destroy() {
    // Defer unmount so React doesn't complain about syncronous unmount
    // mid-render (same workaround bedbase-ui uses).
    setTimeout(() => this.root.unmount(), 0);
  }
}
