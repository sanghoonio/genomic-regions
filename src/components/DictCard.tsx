// DictCard — per-region "dictionary entry" panel. Renders as a floating
// overlay anchored inside the RegionUMAP card whenever a region is picked
// (kind of like a custom legend). Sections: header (region + class +
// length) → NPMI partners over the current file pool (full corpus by
// default; restricted when legend pins or brush selection are active).
// Returns null when nothing is picked.

import type { PickedRegion } from './RegionUMAP';
import { SCREEN_CLASS_COLORS } from '../lib/colors';
import { useTokenNpmiPartners, type PartnerRow } from '../hooks/usePartners';

export function DictCard({
  picked,
  isReady,
  customFileIds,
}: {
  picked: PickedRegion | null;
  isReady: boolean;
  customFileIds?: ReadonlyArray<string> | null;
}) {
  const tokenId = picked?.token_id ?? null;
  const { rows: npmiPartners, meta: npmiMeta, loading: npmiLoading } =
    useTokenNpmiPartners(tokenId, 6, 5, customFileIds);

  // Only render when the user has picked something — this is now a
  // contextual overlay, not a permanent rail.
  if (!isReady || !picked) return null;

  const cclassColor =
    SCREEN_CLASS_COLORS[picked.cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  const poolLabel =
    customFileIds && customFileIds.length > 0
      ? `${customFileIds.length.toLocaleString()} files`
      : 'full corpus';

  return (
    <div className="bg-base-100 rounded-md border border-base-300 shadow-sm p-2 flex flex-col gap-1.5 w-56 max-h-full overflow-y-auto text-[11px] leading-tight">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-mono text-[11px] text-base-content">
          {picked.region}
        </span>
        <span
          className="badge badge-xs text-white border-0"
          style={{ backgroundColor: cclassColor }}
        >
          {picked.cclass}
        </span>
        <span className="text-[10px] text-base-content/60 tabular-nums">
          token {picked.token_id.toLocaleString()}
        </span>
      </div>

      {/* NPMI partners */}
      <PartnerSection
        title={`NPMI partners · ${poolLabel}`}
        accent="text-warning"
        partners={npmiPartners}
        loading={npmiLoading}
        weightLabel="npmi"
        weightFmt={(w) => w.toFixed(3)}
        footer={
          npmiMeta
            ? `Active in ${npmiMeta.n_files_active.toLocaleString()} of ${npmiMeta.n_files_in_pool.toLocaleString()} files in pool`
            : npmiPartners && npmiPartners.length === 0
              ? 'No partners in this pool (token may not have passed PPMI floor).'
              : undefined
        }
      />
    </div>
  );
}

function PartnerSection({
  title,
  accent,
  partners,
  loading,
  weightLabel,
  weightFmt,
  footer,
}: {
  title: string;
  accent: string;
  partners: PartnerRow[] | null;
  loading: boolean;
  weightLabel: string;
  weightFmt: (w: number) => string;
  footer?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`text-[10px] font-semibold ${accent}`}>{title}</div>
      {loading && !partners ? (
        <span className="loading loading-dots loading-xs text-base-content/40" />
      ) : !partners || partners.length === 0 ? (
        <div className="text-[10px] text-base-content/50">No partners.</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {partners.map((p) => (
            <PartnerChip
              key={`${p.partner_token_id}-${p.rank}`}
              partner={p}
              weightLabel={weightLabel}
              weightFmt={weightFmt}
            />
          ))}
        </div>
      )}
      {footer && <div className="text-[10px] text-base-content/50">{footer}</div>}
    </div>
  );
}

function PartnerChip({
  partner,
  weightLabel,
  weightFmt,
}: {
  partner: PartnerRow;
  weightLabel: string;
  weightFmt: (w: number) => string;
}) {
  const color =
    SCREEN_CLASS_COLORS[partner.partner_cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-base-100 border border-base-300 px-1 py-0.5 font-mono text-[10px] leading-tight"
      style={{ borderLeftColor: color, borderLeftWidth: 2 }}
      title={`${partner.partner_region} (${partner.partner_cclass}) — ${weightLabel}=${weightFmt(partner.weight)}`}
    >
      <span className="text-base-content/80">{partner.partner_region}</span>
      <span className="text-base-content/50 tabular-nums">
        {weightFmt(partner.weight)}
      </span>
    </span>
  );
}
