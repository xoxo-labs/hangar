/**
 * The live half of `layout.ts`. It sits in its own file because the decision it
 * wraps is covered by `node --test`, which cannot import react-native.
 */

import { useWindowDimensions } from "react-native"
import { type LayoutMode, layoutModeFor } from "./layout"

/**
 * The window's width, not the screen's: under Split View and Stage Manager the
 * app owns a slice, and `useWindowDimensions` re-renders as that slice is
 * dragged — so the layout follows a resize without a remount.
 */
export function useLayoutMode(): LayoutMode {
  const { width } = useWindowDimensions()
  return layoutModeFor(width)
}
