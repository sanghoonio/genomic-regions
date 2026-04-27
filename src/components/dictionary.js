// Color palettes + Arrow conversion helpers.

export const SCREEN_CLASS_COLORS = {
  PLS: "#ff0000",
  pELS: "#ffa700",
  dELS: "#ffcd00",
  "CA-CTCF": "#00b0f0",
  "CA-H3K4me3": "#ffaaaa",
  unclassed: "#cccccc"
};

export const ASSAY_COLORS = {
  "ATAC-seq": "#1f77b4",
  "DNase-seq": "#2ca02c",
  "ChIP-seq": "#9467bd",
  "TF ChIP-seq": "#e377c2",
  "Histone ChIP-seq": "#ff7f0e"
};

export function classColor(c) {
  return c && SCREEN_CLASS_COLORS[c] ? SCREEN_CLASS_COLORS[c] : SCREEN_CLASS_COLORS.unclassed;
}

export function assayColor(a) {
  return (a && ASSAY_COLORS[a]) ?? "#888";
}

export const SCREEN_CLASS_COLOR_DOMAIN = Object.keys(SCREEN_CLASS_COLORS).filter((k) => k !== "unclassed");
export const SCREEN_CLASS_COLOR_RANGE = SCREEN_CLASS_COLOR_DOMAIN.map((k) => SCREEN_CLASS_COLORS[k]);
export const ASSAY_COLOR_DOMAIN = Object.keys(ASSAY_COLORS);
export const ASSAY_COLOR_RANGE = Object.values(ASSAY_COLORS);

// Convert a DuckDB Arrow query result into plain JS row objects.
// - Arrow `Vector` list columns → JS arrays (bracket-indexing on a Vector is broken).
// - BigInt (parquet int64) → Number.
export function arrowToRows(result) {
  const isArrowVector = (v) =>
    typeof v === "object" && v !== null && typeof v.toArray === "function";

  return result.toArray().map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "bigint") {
        out[k] = Number(v);
      } else if (Array.isArray(v)) {
        out[k] = v.map((x) => (typeof x === "bigint" ? Number(x) : x));
      } else if (isArrowVector(v)) {
        out[k] = Array.from(v.toArray()).map((x) => (typeof x === "bigint" ? Number(x) : x));
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

// Stable per-file display label. Used as the y-axis category in Steps 1/2.
export function fileLabel(f) {
  return `${f.cell_line || "—"} · ${f.target || f.assay}`;
}
