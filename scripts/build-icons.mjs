#!/usr/bin/env node
/**
 * Regenerates every app icon from assets/hangar.svg.
 *
 * The outputs are committed, so this only runs when the artwork changes — the
 * builds (electron-builder, Expo, Vite) read the generated files, never this
 * script. It needs rsvg-convert (`brew install librsvg`); iconutil ships with
 * macOS.
 *
 * Each platform wants the square artwork shaped differently:
 *   - macOS masks nothing, so the .icns has to carry the squircle itself, inset
 *     in a transparent canvas the way Apple's grid places it.
 *   - iOS and the web home screen mask a full-bleed square, so those get the
 *     artwork as drawn.
 *   - Android composes two layers and can crop either into any shape a launcher
 *     likes, so the mark and its plate are exported separately, and the mark is
 *     kept inside the safe circle.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ART = readFileSync(join(ROOT, "assets/hangar.svg"), "utf8")
const GLYPH = readFileSync(join(ROOT, "assets/hangar-glyph.svg"), "utf8")

/** The viewBox both source files are drawn in. */
const SRC = 800

/**
 * Inlines a source file as a nested <svg>, which re-anchors its viewBox to the
 * given box in the parent's coordinates. The XML declaration and any comments
 * before the root element have to go: only one can be at the top of a document.
 */
function place(source, { x, y, size }) {
  const root = source.indexOf("<svg")
  const inner = source.slice(source.indexOf(">", root) + 1)
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${SRC} ${SRC}">${inner}`
}

/**
 * The macOS icon shape: a superellipse (|x|^5 + |y|^5 = 1), which is the shape
 * Apple's continuous corners approximate. Sampled as a polygon rather than
 * fitted with Béziers — at 1024 px, 512 points are well under a pixel apart.
 */
function squircle(cx, cy, radius, points = 512) {
  const power = 2 / 5
  const at = (t) => {
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = cx + radius * Math.sign(c) * Math.abs(c) ** power
    const y = cy + radius * Math.sign(s) * Math.abs(s) ** power
    return `${x.toFixed(3)},${y.toFixed(3)}`
  }
  const steps = Array.from({ length: points }, (_, i) => at((2 * Math.PI * i) / points))
  return `M${steps.join("L")}Z`
}

const TMP = mkdtempSync(join(tmpdir(), "hangar-icons-"))
const written = []

function rasterize(svg, size, path, opaque) {
  const scratch = join(TMP, "frame.svg")
  writeFileSync(scratch, svg)
  mkdirSync(dirname(path), { recursive: true })
  // -b paints a background under the artwork: the App Store rejects an iOS icon
  // with an alpha channel, and the artwork's own plate is opaque anyway.
  const background = opaque ? ["-b", "#000000"] : []
  execFileSync("rsvg-convert", [...background, "-w", String(size), "-h", String(size), scratch, "-o", path])
}

/** Rasterizes to a committed path, named relative to the repo root. */
function render(svg, { size, out, opaque = false }) {
  rasterize(svg, size, join(ROOT, out), opaque)
  written.push(out)
}

// --- macOS ------------------------------------------------------------------

// Apple's grid: the icon body is 824 of the 1024 pt canvas, leaving the margin
// its shadow lives in. The shadow is what makes an icon sit on the Dock instead
// of floating above it; keep it soft enough to read at 32 px.
const MAC_CANVAS = 1024
const MAC_BODY = 824
const macIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${MAC_CANVAS}" height="${MAC_CANVAS}" viewBox="0 0 ${MAC_CANVAS} ${MAC_CANVAS}">
  <defs>
    <clipPath id="shape"><path d="${squircle(MAC_CANVAS / 2, MAC_CANVAS / 2, MAC_BODY / 2)}"/></clipPath>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <g clip-path="url(#shape)">
      ${place(ART, { x: (MAC_CANVAS - MAC_BODY) / 2, y: (MAC_CANVAS - MAC_BODY) / 2, size: MAC_BODY })}
    </g>
  </g>
</svg>`

const iconset = join(TMP, "hangar.iconset")
mkdirSync(iconset, { recursive: true })
for (const base of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const name = `icon_${base}x${base}${scale === 2 ? "@2x" : ""}.png`
    rasterize(macIcon, base * scale, join(iconset, name), false)
  }
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(ROOT, "apps/desktop/assets/icon.icns")])
written.push("apps/desktop/assets/icon.icns")

// The .icns only reaches the Dock through a packaged bundle; a development run
// is a bare Electron binary that has to be handed the same artwork at runtime.
render(macIcon, { size: 1024, out: "apps/desktop/assets/icon.png" })

// --- iOS + Android (Expo) ---------------------------------------------------

const full = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${place(ART, { x: 0, y: 0, size: 1024 })}</svg>`
render(full, { size: 1024, out: "apps/mobile/assets/icon.png", opaque: true })

// Android crops the two layers to whatever shape the launcher uses; only the
// middle 66% of each is guaranteed to survive it, so the mark is drawn at 62%
// and the plate is the artwork's gradient stretched edge to edge.
const SAFE = Math.round(1024 * 0.62)
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${place(GLYPH, { x: (1024 - SAFE) / 2, y: (1024 - SAFE) / 2, size: SAFE })}</svg>`
render(foreground, { size: 1024, out: "apps/mobile/assets/adaptive-icon.png" })

// Android 13 themed icons recolor a single-channel mark; !important is how CSS
// overrides the gradients the presentation attributes name.
const monochrome = foreground.replace(
  "<defs>",
  "<style>path { fill: #ffffff !important; stroke: none !important; }</style><defs>",
)
render(monochrome, { size: 1024, out: "apps/mobile/assets/adaptive-icon-monochrome.png" })

const plate = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="url(#plate)"/>
  <defs><linearGradient id="plate" x1="415" y1="795" x2="415" y2="0" gradientUnits="userSpaceOnUse"><stop/><stop offset="1" stop-color="#363636"/></linearGradient></defs>
</svg>`
render(plate, { size: 1024, out: "apps/mobile/assets/adaptive-icon-background.png", opaque: true })

// --- Web --------------------------------------------------------------------

// Served as-is, minus the note above the root element that only matters here.
writeFileSync(join(ROOT, "apps/web/public/favicon.svg"), ART.slice(ART.indexOf("<svg")))
written.push("apps/web/public/favicon.svg")

// A tab strip is 16 px: the SVG is what browsers prefer, the PNGs are for the
// ones that ignore it. iOS masks apple-touch-icon itself, hence full bleed.
for (const size of [32, 180, 192, 512]) {
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`
  render(full, { size, out: `apps/web/public/${name}`, opaque: true })
}

// A maskable icon is cropped to the launcher's shape, so it repeats the Android
// safe-zone trick: plate to the edges, mark at 62%.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="url(#plate)"/>
  <defs><linearGradient id="plate" x1="531" y1="1017" x2="531" y2="0" gradientUnits="userSpaceOnUse"><stop/><stop offset="1" stop-color="#363636"/></linearGradient></defs>
  ${place(GLYPH, { x: (1024 - SAFE) / 2, y: (1024 - SAFE) / 2, size: SAFE })}
</svg>`
render(maskable, { size: 512, out: "apps/web/public/icon-512-maskable.png", opaque: true })

rmSync(TMP, { recursive: true, force: true })
for (const out of written) console.log(out)
