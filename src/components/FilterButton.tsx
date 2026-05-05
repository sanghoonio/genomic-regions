// Centralised filter manager — sits in the FileUMAP card actions slot and
// summarises the active file-pool filter (legend pins across fields +
// brushed selection). Pins are added via clicking legend swatches in the
// FileUMAP; this button is the single place to *see* and *remove* them
// without having to flip the colorBy back and forth.

import { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';

export function FilterButton({
  pinnedAssays,
  pinnedCellLines,
  brushedCount,
  onTogglePinAssay,
  onTogglePinCellLine,
  onClearBrush,
  onClearAll,
}: {
  pinnedAssays: ReadonlySet<string>;
  pinnedCellLines: ReadonlySet<string>;
  brushedCount: number;
  onTogglePinAssay: (label: string) => void;
  onTogglePinCellLine: (label: string) => void;
  onClearBrush: () => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const totalCount =
    pinnedAssays.size + pinnedCellLines.size + (brushedCount > 0 ? 1 : 0);
  const hasAny = totalCount > 0;

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={`inline-flex items-center gap-1.5 -my-1 text-[10px] leading-none font-medium border px-1.5 py-0.5 rounded-md transition-colors cursor-pointer ${
          hasAny
            ? 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/15'
            : 'text-base-content/70 hover:text-base-content bg-base-100 hover:bg-base-200 border-base-300'
        }`}
        title="Active filter"
      >
        <Filter size={11} />
        Filter
        {hasAny && (
          <span className="font-normal text-primary/70">({totalCount})</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-64 overflow-y-auto overscroll-contain max-h-96">
            {!hasAny ? (
              <div className="px-3 py-3 text-xs text-base-content/60 leading-snug">
                No filter active. Click a swatch in the legend to pin a
                category, or brush a region on the plot to define a custom
                selection.
              </div>
            ) : (
              <>
                {brushedCount > 0 && (
                  <Section title="Brushed">
                    <PinRow
                      label={`${brushedCount.toLocaleString()} files`}
                      onRemove={onClearBrush}
                    />
                  </Section>
                )}
                {pinnedAssays.size > 0 && (
                  <Section title="Assay pins">
                    {[...pinnedAssays].map((label) => (
                      <PinRow
                        key={label}
                        label={label}
                        onRemove={() => onTogglePinAssay(label)}
                      />
                    ))}
                  </Section>
                )}
                {pinnedCellLines.size > 0 && (
                  <Section title="Cell line pins">
                    {[...pinnedCellLines].map((label) => (
                      <PinRow
                        key={label}
                        label={label}
                        onRemove={() => onTogglePinCellLine(label)}
                      />
                    ))}
                  </Section>
                )}
                <div className="px-2 py-1.5 border-t border-base-300">
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setOpen(false);
                    }}
                    className="w-full text-left px-2 py-1 text-xs text-base-content/70 hover:bg-error/10 hover:text-error rounded transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-3 py-1.5 bg-base-200 border-b border-base-300 text-[10px] font-bold text-base-content/60 uppercase tracking-wider">
        {title}
      </div>
      <ul className="py-1">{children}</ul>
    </div>
  );
}

function PinRow({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="flex items-center justify-between px-3 py-1 text-xs hover:bg-base-200 transition-colors">
      <span className="text-base-content/80 truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-base-content/40 hover:text-error transition-colors cursor-pointer p-0.5"
        title="Remove"
      >
        <X size={11} />
      </button>
    </li>
  );
}
