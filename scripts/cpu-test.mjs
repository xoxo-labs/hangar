const RAMP_SECONDS = 15
const SUSTAIN_SECONDS = 60
const SLICE_MS = 100

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function loadCpu(percent, durationMs) {
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    const sliceStarted = performance.now()
    const busyUntil = sliceStarted + (SLICE_MS * percent) / 100
    while (performance.now() < busyUntil) {
      // Intentionally occupy one CPU core.
    }
    await sleep(Math.max(0, SLICE_MS - (performance.now() - sliceStarted)))
  }
}

console.log(`Ramping CPU to 100% over ${RAMP_SECONDS}s…`)
for (let second = 1; second <= RAMP_SECONDS; second += 1) {
  const percent = Math.round((second / RAMP_SECONDS) * 100)
  console.log(`CPU target: ${percent}%`)
  await loadCpu(percent, 1_000)
}

console.log(`Holding CPU at 100% for ${SUSTAIN_SECONDS}s…`)
for (let remaining = SUSTAIN_SECONDS; remaining > 0; remaining -= 1) {
  if (remaining === SUSTAIN_SECONDS || remaining % 10 === 0) {
    console.log(`${remaining}s remaining`)
  }
  await loadCpu(100, 1_000)
}

console.log("CPU test complete")
