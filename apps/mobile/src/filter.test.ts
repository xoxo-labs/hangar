import assert from "node:assert/strict"
import { test } from "node:test"
import { filterMachines, type MachineMatch, matchesMachine, normalizeQuery } from "./filter.ts"

const studio: MachineMatch = { name: "Studio", host: "192.168.1.20", port: 4780 }
const laptop: MachineMatch = { name: "Sorins-MacBook-Pro.local", host: "100.90.1.5", port: 4899 }

test("normalizeQuery is what the sidebar model asks for", () => {
  assert.equal(normalizeQuery("  Studio  "), "studio")
  assert.equal(normalizeQuery(""), "")
  assert.equal(normalizeQuery("   "), "")
})

test("a machine matches on its name, whatever the case", () => {
  assert.equal(matchesMachine(studio, "stu"), true)
  assert.equal(matchesMachine(laptop, "macbook"), true)
  assert.equal(matchesMachine(studio, "laptop"), false)
})

test("a machine matches on its address, host or port", () => {
  assert.equal(matchesMachine(studio, "192.168"), true)
  assert.equal(matchesMachine(studio, "4780"), true)
  assert.equal(matchesMachine(studio, "192.168.1.20:4780"), true)
  assert.equal(matchesMachine(studio, "4899"), false)
})

test("an empty query keeps everything", () => {
  assert.equal(matchesMachine(studio, ""), true)
  const machines = [studio, laptop]
  assert.deepEqual(
    filterMachines(machines, "  ", (machine) => machine),
    machines,
  )
})

test("filterMachines keeps the order it was given", () => {
  const machines = [studio, laptop, { name: "Studio B", host: "10.0.0.9", port: 4780 }]
  assert.deepEqual(
    filterMachines(machines, "STUDIO", (machine) => machine).map((machine) => machine.name),
    ["Studio", "Studio B"],
  )
})

test("nothing matches an unknown machine", () => {
  assert.deepEqual(
    filterMachines([studio, laptop], "nas", (machine) => machine),
    [],
  )
})
