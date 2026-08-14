/** Old `.toggle-row` and its `input` / `span` / `strong` / `small` descendants. */
export function ToggleRow({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  title: string
  hint: string
}) {
  return (
    <label className="flex w-full items-start gap-[9px] rounded-md border border-surface-5 bg-surface-a2 p-[9px]">
      <input
        type="checkbox"
        className="mt-0.5 accent-accent-9"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <strong className="text-base font-book">{title}</strong>
        <small className="text-xs text-surface-9">{hint}</small>
      </span>
    </label>
  )
}
