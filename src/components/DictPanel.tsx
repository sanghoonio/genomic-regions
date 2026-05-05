// Dictionary entry — a fudoki-inspired flow row of partner chips. The
// picked region's chip sits in its natural genomic position within the
// row; partners with smaller starts precede it, larger starts follow.
// Width per chip encodes NPMI rank (top partner is widest, lowest is
// narrowest). Clicking a partner pans the chr-distribution strip to
// that partner's midpoint.
//
// Renders a placeholder when no region is picked.

import type { PickedRegion } from './RegionUMAP';
import { SCREEN_CLASS_COLORS } from '../lib/colors';
import { useTokenNpmiPartners, type PartnerRow } from '../hooks/usePartners';

const CCLASS_ABBREV: Record<string, string> = {
  PLS: 'PLS',
  pELS: 'pELS',
  dELS: 'dELS',
  'CA-CTCF': 'CTCF',
  'CA-H3K4me3': 'K4me3',
  'CA-TF': 'CA-TF',
  CA: 'CA',
  TF: 'TF',
  unclassed: '—',
};

// Width encodes NPMI rank: top-rank partner is widest, lowest is
// narrowest. Min is wide enough that the longest possible distance
// label (e.g., "−12.34 Mb") never wraps, so the row stays a clean
// single-line glyph per chip even at the lowest ranks.
const CHIP_MIN_WIDTH_PX = 96;
const CHIP_MAX_WIDTH_PX = 170;

// Signed-distance label, scaled by magnitude. `0` for the picked
// chip; everything else gets `+` / `−` (unicode minus) followed by a
// kb or Mb amount. Mb uses 2 decimals near the boundary so 1.05 Mb
// reads as fine-grained, larger jumps lose precision.
function formatDistance(deltaBp: number): string {
  if (deltaBp === 0) return '0';
  const sign = deltaBp > 0 ? '+' : '−';
  const abs = Math.abs(deltaBp);
  if (abs < 1_000_000) return `${sign}${(abs / 1_000).toFixed(0)} kb`;
  return `${sign}${(abs / 1_000_000).toFixed(2)} Mb`;
}

// Programmatic one-line summary of how the partners sit relative to
// the picked region. Two heuristic axes: spatial proximity (median
// absolute distance) and class similarity (fraction sharing the
// anchor's cclass). The phrasing is intentionally hedged — these are
// quick reads, not statistical claims.
function summarizeStrip(
  picked: PickedRegion,
  partners: PartnerRow[],
): string {
  const n = partners.length;
  if (n === 0) return '';

  // Median absolute distance from the anchor (signed-direction
  // doesn't matter for "how spread out is this neighborhood").
  const dists = partners
    .map((p) =>
      Math.abs(Math.round((p.partner_start + p.partner_end) / 2) - picked.midpoint),
    )
    .sort((a, b) => a - b);
  const medianDist = dists[Math.floor(n / 2)];

  let proximity: string;
  if (medianDist < 50_000) proximity = 'cluster tightly around the anchor';
  else if (medianDist < 500_000)
    proximity = 'cluster within the local neighborhood';
  else if (medianDist < 2_000_000)
    proximity = 'spread across a wider neighborhood';
  else if (medianDist < 5_000_000)
    proximity = 'span a multi-Mb region of the chromosome';
  else proximity = 'scatter across the chromosome';

  // Class composition vs anchor.
  const sameClass = partners.filter(
    (p) => p.partner_cclass === picked.cclass,
  ).length;
  const sameFrac = sameClass / n;
  const classCounts: Record<string, number> = {};
  for (const p of partners) {
    classCounts[p.partner_cclass] =
      (classCounts[p.partner_cclass] ?? 0) + 1;
  }
  const [dominantClass, dominantCount] =
    Object.entries(classCounts).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];

  let classPhrase: string;
  if (sameFrac === 1)
    classPhrase = `all share the anchor's ${picked.cclass} class`;
  else if (sameFrac >= 0.75)
    classPhrase = `mostly share the anchor's ${picked.cclass} class`;
  else if (sameFrac >= 0.5)
    classPhrase = `lean toward the anchor's ${picked.cclass} class`;
  else if (dominantCount / n >= 0.5)
    classPhrase = `lean ${dominantClass} rather than the anchor's ${picked.cclass}`;
  else classPhrase = 'span a mix of regulatory classes';

  return `These ${n} partners ${proximity} and ${classPhrase}.`;
}

export type DictNavTarget = {
  /** bp midpoint — recenters the chr-dist zoom windows. */
  position: number;
  /** UMAP coords — recenters the region UMAP (bedbase centerOnPoint). */
  umap_x: number;
  umap_y: number;
};

export function DictPanel({
  picked,
  isReady,
  customFileIds,
  onNavigate,
}: {
  picked: PickedRegion | null;
  isReady: boolean;
  customFileIds?: ReadonlyArray<string> | null;
  /** Called when the user clicks any chip (picked or partner). Parent
   * uses the supplied target to pan the chr-dist windows AND recenter
   * the region UMAP — analog of bedbase-ui's centerOnPoint. */
  onNavigate?: (target: DictNavTarget) => void;
}) {
  const tokenId = picked?.token_id ?? null;
  const { rows: npmiPartners, meta: npmiMeta, loading: npmiLoading } =
    useTokenNpmiPartners(tokenId, 30, 5, customFileIds);

  return (
    <div className="flex-1 min-h-0 w-full bg-base-100 border border-base-300 rounded-lg p-3 flex flex-col gap-2 overflow-y-auto">
      {!isReady ? (
        <span className="text-xs text-base-content/50">Initializing…</span>
      ) : !picked ? (
        <span className="text-xs text-base-content/50">
          Click a region on the region UMAP to populate the dictionary entry.
        </span>
      ) : (
        <PickedContent
          picked={picked}
          npmiPartners={npmiPartners}
          npmiLoading={npmiLoading}
          npmiMeta={npmiMeta}
          poolLabel={
            customFileIds && customFileIds.length > 0
              ? `${customFileIds.length.toLocaleString()} files`
              : 'full corpus'
          }
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

function PickedContent({
  picked,
  npmiPartners,
  npmiLoading,
  npmiMeta,
  poolLabel,
  onNavigate,
}: {
  picked: PickedRegion;
  npmiPartners: PartnerRow[] | null;
  npmiLoading: boolean;
  npmiMeta: { n_files_active: number; n_files_in_pool: number } | null;
  poolLabel: string;
  onNavigate?: (target: DictNavTarget) => void;
}) {
  const cclassColor =
    SCREEN_CLASS_COLORS[picked.cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  return (
    <>
      {/* Region header — restores the pre-strip caption: region name +
          cclass badge + token id / region width. */}
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm text-base-content">
          {picked.region}
        </span>
        <span
          className="badge badge-sm text-white border-0"
          style={{ backgroundColor: cclassColor }}
        >
          {picked.cclass}
        </span>
        <span className="text-[11px] text-base-content/60 tabular-nums">
          token {picked.token_id.toLocaleString()} ·{' '}
          {(picked.end - picked.start).toLocaleString()} bp
        </span>
      </div>

      {/* Partner section caption — when an NPMI re-fetch is in flight
          AND we already have partners on screen, show a small dots
          spinner alongside the heading so the stale chips read as
          "about to refresh". */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-warning">
            Co-occurrence partners · {poolLabel} · top 30
          </span>
          {npmiLoading && npmiPartners && (
            <span
              className="loading loading-dots loading-xs text-base-content/40"
              title="Recomputing partners…"
            />
          )}
        </div>
      {npmiLoading && !npmiPartners ? (
        <span className="loading loading-dots loading-sm text-base-content/40" />
      ) : !npmiPartners || npmiPartners.length === 0 ? (
        <div className="text-[11px] text-base-content/50">
          No partners in this pool (token may not have passed PPMI floor).
        </div>
      ) : (
        <>
          {/* Dim the chips while a re-fetch is in flight — they still
              read but visually pull back so the user notices fresher
              data is on the way. */}
          <div
            className={
              npmiLoading
                ? 'opacity-50 transition-opacity'
                : 'transition-opacity'
            }
          >
            <PartnerStrip
              picked={picked}
              partners={npmiPartners}
              onNavigate={onNavigate}
            />
          </div>
          <p className="text-[11px] italic text-base-content/60 leading-snug mt-1 flex items-center gap-1.5">
            <span className={npmiLoading ? 'opacity-50' : undefined}>
              {summarizeStrip(picked, npmiPartners)}
            </span>
            {npmiLoading && (
              <span className="loading loading-dots loading-xs text-base-content/30" />
            )}
          </p>
        </>
      )}
        {npmiMeta && (
          <div className="text-[10px] text-base-content/50">
            Token active in {npmiMeta.n_files_active.toLocaleString()} of{' '}
            {npmiMeta.n_files_in_pool.toLocaleString()} files in pool.
          </div>
        )}
      </div>
    </>
  );
}

type StripEntry =
  | { kind: 'picked'; start: number; midpoint: number }
  | {
      kind: 'partner';
      partner: PartnerRow;
      start: number;
      midpoint: number;
      widthPx: number;
    };

function PartnerStrip({
  picked,
  partners,
  onNavigate,
}: {
  picked: PickedRegion;
  partners: PartnerRow[];
  onNavigate?: (target: DictNavTarget) => void;
}) {
  // Build the ordered list: every partner + the picked region, sorted
  // ascending by start. The picked entry naturally lands at the index
  // that splits before/after partners — fudoki-style "you are here".
  const entries: StripEntry[] = [];
  const N = partners.length;
  for (const p of partners) {
    // Map rank → width. Rank 1 (top NPMI) gets CHIP_MAX_WIDTH_PX;
    // rank N gets CHIP_MIN_WIDTH_PX. Min is calibrated to never wrap
    // the longest distance label.
    const t = N > 1 ? (p.rank - 1) / (N - 1) : 0;
    const widthPx = Math.round(
      CHIP_MAX_WIDTH_PX - t * (CHIP_MAX_WIDTH_PX - CHIP_MIN_WIDTH_PX),
    );
    const midpoint = Math.round((p.partner_start + p.partner_end) / 2);
    entries.push({
      kind: 'partner',
      partner: p,
      start: p.partner_start,
      midpoint,
      widthPx,
    });
  }
  entries.push({
    kind: 'picked',
    start: picked.start,
    midpoint: picked.midpoint,
  });
  entries.sort((a, b) => a.start - b.start);

  return (
    <div className="flex flex-wrap gap-1.5 items-stretch">
      {entries.map((e) =>
        e.kind === 'picked' ? (
          <PickedChip
            key={`picked-${picked.token_id}`}
            picked={picked}
            onClick={() =>
              onNavigate?.({
                position: picked.midpoint,
                umap_x: picked.umap_x,
                umap_y: picked.umap_y,
              })
            }
          />
        ) : (
          <PartnerChip
            key={`p-${e.partner.partner_token_id}`}
            partner={e.partner}
            distanceBp={e.midpoint - picked.midpoint}
            widthPx={e.widthPx}
            onClick={() =>
              onNavigate?.({
                position: e.midpoint,
                umap_x: e.partner.partner_umap_x,
                umap_y: e.partner.partner_umap_y,
              })
            }
          />
        ),
      )}
    </div>
  );
}

// Fudoki-inspired chip: page-color body with the position as the
// primary glyph; a small "chin" footer in the SCREEN-class color
// carries the abbreviation as a label. The chin is the chip's POS-tag
// equivalent — it both colors the chip and labels its class in one
// piece. Width scales with NPMI rank.
function Chin({ abbr, color }: { abbr: string; color: string }) {
  return (
    <span
      className="block w-full text-center text-[7px] uppercase tracking-wide font-medium text-white leading-tight px-1.5 py-px rounded-b-sm"
      // SCREEN-class background — has to be inline since the palette
      // is data-driven.
      style={{ backgroundColor: color }}
    >
      {abbr}
    </span>
  );
}

function PickedChip({
  picked,
  onClick,
}: {
  picked: PickedRegion;
  onClick: () => void;
}) {
  const color =
    SCREEN_CLASS_COLORS[picked.cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  const abbr = CCLASS_ABBREV[picked.cclass] ?? picked.cclass;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-col items-stretch justify-end overflow-hidden rounded-sm hover:bg-base-200 transition-colors cursor-pointer text-center"
      style={{ width: CHIP_MAX_WIDTH_PX }}
      title={`${picked.region} · ${picked.cclass} · picked · click to recenter zoom`}
    >
      {/* No outline on the picked variant — the saturated inset ring
          and class-tinted body already do the "you are here" work and
          a faint border on top would just blur that signal. */}
      <span
        className="block w-full font-mono leading-tight px-2 pt-1 pb-1 rounded-t-sm"
        style={{
          backgroundColor: `${color}1f`, // ~12% alpha
          boxShadow: `inset 0 0 0 1.5px ${color}`,
        }}
      >
        <span className="block text-[8px] tabular-nums text-base-content/40">
          anchor
        </span>
        <span className="block text-[10px] font-semibold tabular-nums">
          {formatDistance(0)}
        </span>
      </span>
      <Chin abbr={abbr} color={color} />
    </button>
  );
}

function PartnerChip({
  partner,
  distanceBp,
  widthPx,
  onClick,
}: {
  partner: PartnerRow;
  /** Signed bp distance to the picked region (partner.midpoint − picked.midpoint). */
  distanceBp: number;
  /** Pixel width — encodes NPMI rank (top is widest). */
  widthPx: number;
  onClick: () => void;
}) {
  const color =
    SCREEN_CLASS_COLORS[partner.partner_cclass] ??
    SCREEN_CLASS_COLORS.unclassed;
  const abbr = CCLASS_ABBREV[partner.partner_cclass] ?? partner.partner_cclass;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-col items-stretch justify-end overflow-hidden rounded-sm hover:bg-base-200 transition-colors cursor-pointer text-center"
      style={{ width: widthPx }}
      title={`${partner.partner_region} · ${partner.partner_cclass} · npmi=${partner.weight.toFixed(3)} · click to pan zoom`}
    >
      {/* Faint top + side outline on the text panel only — the chin
          stays a clean color block. */}
      <span className="block w-full font-mono leading-tight px-2 pt-1 pb-1 border-x border-t border-b-0 border-base-content/[0.06] rounded-t-sm">
        <span className="block text-[8px] tabular-nums text-base-content/45">
          {partner.weight.toFixed(3)}
        </span>
        <span className="block text-[10px] tabular-nums">
          {formatDistance(distanceBp)}
        </span>
      </span>
      <Chin abbr={abbr} color={color} />
    </button>
  );
}
