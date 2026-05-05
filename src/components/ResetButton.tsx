// Red chip-style reset button for UMAPCard `actions` slots. Same
// compact dimensions as ColorByPicker / FilterButton so it lines up
// in the header strip; rendered in error semantic tokens to flag the
// destructive nature of the action without an icon.

export function ResetButton({
  onClick,
  title = 'Reset',
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center -my-1 text-[11px] leading-none font-medium text-error-content bg-error hover:bg-error/85 border border-error/80 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer"
    >
      Reset
    </button>
  );
}
