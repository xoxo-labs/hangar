import assert from "node:assert/strict"
import { test } from "node:test"
import { conflictPorts, describeConflict, mentionsPortConflict, parsePortHolder, portConflict } from "./diagnose.ts"

test("the port comes out of the message each runtime actually prints", () => {
  const cases: Array<[string, number[]]> = [
    ["Error: listen EADDRINUSE: address already in use :::3201", [3201]],
    ["Error: listen EADDRINUSE: address already in use 0.0.0.0:3000", [3000]],
    ["✘ [ERROR] Port 5173 is already in use", [5173]],
    ["listen tcp :8080: bind: address already in use", [8080]],
    [`Address already in use - bind(2) for "127.0.0.1" port 3000 (Errno::EADDRINUSE)`, [3000]],
    ["Error: That port is already in use.", []],
    ["OSError: [Errno 48] Address already in use", []],
  ]
  for (const [line, expected] of cases) assert.deepEqual(conflictPorts(line), expected, line)
})

test("ANSI colouring and surrounding output do not hide the port", () => {
  const tail = [
    "\x1b[32m  ➜  Local:\x1b[0m http://localhost:4173/",
    "restarting…",
    "\x1b[31mError: listen EADDRINUSE: address already in use :::3201\x1b[0m",
    "    at Server.setupListenHandle [as _listen2] (node:net:1908:16)",
  ].join("\n")
  assert.deepEqual(conflictPorts(tail), [3201])
})

test("a failure that is not about ports stays undiagnosed", () => {
  const tail = ["> vite build", "Error: Cannot find module './missing.js'", "exit status 1"].join("\n")
  assert.deepEqual(conflictPorts(tail), [])
  assert.equal(mentionsPortConflict(tail), false)
})

test("numbers that only look like ports are not treated as one", () => {
  // A clock reads like an address; a two-digit "port" would name someone else's
  // real listener (sshd on 22), so the suffix form starts at three digits.
  assert.deepEqual(conflictPorts("10:22:33 fatal: address already in use"), [])
  // Named outright, it is the process's own claim and gets taken at face value.
  assert.deepEqual(conflictPorts("fatal: port 80 is already in use"), [80])
  assert.deepEqual(conflictPorts("listen: address already in use on :99999"), [])
})

test("only the tail is searched, so an old conflict cannot explain a later crash", () => {
  const stale = "Error: listen EADDRINUSE: address already in use :::3201\n" + "log line\n".repeat(2000)
  assert.deepEqual(conflictPorts(stale), [])
})

test("lsof field output yields the first listener's pid and command", () => {
  assert.deepEqual(parsePortHolder("p98910\nnode\ncnode\nfcwd\nn*:3201\n"), { pid: 98910, command: "node" })
  assert.deepEqual(parsePortHolder("p98910\ncnode\np12\ncpython3\n"), { pid: 98910, command: "node" })
  assert.equal(parsePortHolder(""), null)
})

test("the sentence names the port, the holder, and whose it is", () => {
  assert.equal(
    describeConflict(3201, { pid: 98910, command: "node" }),
    "port 3201 is held by pid 98910 (node), which hangar does not manage",
  )
  assert.equal(
    describeConflict(3201, { pid: 98910, command: "node", session: "api/web" }),
    "port 3201 is held by api/web (pid 98910), started by hangar",
  )
  assert.equal(describeConflict(3201), "port 3201 was in use at startup; nothing holds it now")
})

test("a diagnosis carries the holder only when there is one", () => {
  const withHolder = portConflict(3201, { pid: 98910, command: "node" })
  assert.equal(withHolder.kind, "port_conflict")
  assert.deepEqual(withHolder.holder, { pid: 98910, command: "node" })
  assert.equal("holder" in portConflict(3201), false)
})
