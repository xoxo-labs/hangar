import type { BrowserChoice } from "@hangar/contracts"
import type { SelectHTMLAttributes } from "react"
import { Select } from "../ui/Field"

export function BrowserSelect({
  inheritLabel,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  inheritLabel?: string
  value: BrowserChoice | ""
  onChange: SelectHTMLAttributes<HTMLSelectElement>["onChange"]
}) {
  return (
    <Select {...props}>
      {inheritLabel !== undefined && <option value="">{inheritLabel}</option>}
      <option value="system">System default</option>
      {window.hangarDesktop && (
        <>
          <option value="safari">Safari</option>
          <option value="chrome">Google Chrome</option>
          <option value="arc">Arc</option>
          <option value="firefox">Firefox</option>
          <option value="brave">Brave</option>
          <option value="edge">Microsoft Edge</option>
        </>
      )}
    </Select>
  )
}
