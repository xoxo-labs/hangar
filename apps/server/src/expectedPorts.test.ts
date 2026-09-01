import assert from "node:assert/strict"
import { test } from "node:test"
import { expectedPorts, type PortGuess } from "./expectedPorts.ts"

function ports(guesses: PortGuess[]): number[] {
  return guesses.map((guess) => guess.port)
}

test("every explicit spelling names its port outright", () => {
  const cases: Array<[string, number, string]> = [
    ["next dev --port 3011", 3011, "--port 3011"],
    ["next dev --port=3011", 3011, "--port=3011"],
    ["next dev -p 3011", 3011, "-p 3011"],
    ["next dev -p=3011", 3011, "-p=3011"],
    ["PORT=4000 node server.js", 4000, "PORT=4000"],
  ]
  for (const [cmd, port, evidence] of cases) {
    const guesses = expectedPorts(cmd)
    assert.equal(guesses.length, 1, cmd)
    assert.equal(guesses[0]!.port, port, cmd)
    assert.equal(guesses[0]!.evidence, evidence, cmd)
    assert.equal(guesses[0]!.certain, true, cmd)
  }
})

test("docker's -p is host:container, and only the host side is a local port", () => {
  assert.deepEqual(ports(expectedPorts("docker run -p 8080:80 nginx")), [8080])
  assert.deepEqual(ports(expectedPorts("docker run -p 127.0.0.1:8080:80/tcp nginx")), [8080])
  // A bare container port publishes to a random host port: nothing to predict.
  assert.deepEqual(expectedPorts("docker run -p 80 nginx"), [])
  // On `docker compose`, -p names the project, not a port.
  assert.deepEqual(expectedPorts("docker compose up -p 8080"), [])
})

test("a package manager's -p is never a port", () => {
  // `pnpm -p 3000` would be a --prod install, not a port; guessing 3000 here
  // is exactly the confidently-wrong answer this module must not give.
  assert.deepEqual(expectedPorts("pnpm -p 3000"), [])
  assert.deepEqual(expectedPorts("npm install -p 8080"), [])
  // --port passes through managers to the script, so it still counts.
  assert.deepEqual(ports(expectedPorts("pnpm run dev -- --port 3001")), [3001])
})

test("a port flag we cannot read poisons the guess instead of falling back", () => {
  // The user overrode the port; offering the framework default back is the
  // one answer known to be wrong.
  assert.deepEqual(expectedPorts("next dev --port 99999"), [])
  assert.deepEqual(expectedPorts("next dev --port $PORT"), [])
})

test("manager invocations resolve one script hop through the given scripts", () => {
  const scripts = { dev: "vite --port 5199" }
  for (const cmd of ["pnpm run dev", "pnpm dev", "npm run dev", "yarn dev", "bun run dev", "bun dev"]) {
    assert.deepEqual(ports(expectedPorts(cmd, { scripts })), [5199], cmd)
  }
  // npm without `run` only knows its lifecycle scripts; `npm dev` is an error.
  assert.deepEqual(expectedPorts("npm dev", { scripts }), [])
  assert.deepEqual(ports(expectedPorts("npm start", { scripts: { start: "node server.js --port 8123" } })), [8123])
})

test("args after the script name reach the script, so late flags still win", () => {
  const scripts = { dev: "storybook dev" }
  // -p is denied on pnpm itself but belongs to storybook once resolved.
  assert.deepEqual(ports(expectedPorts("pnpm dev -p 6007", { scripts })), [6007])
  assert.deepEqual(ports(expectedPorts("pnpm dev", { scripts })), [6006])
})

test("a script that names itself, or a cycle of scripts, resolves to nothing", () => {
  assert.deepEqual(expectedPorts("pnpm run dev", { scripts: { dev: "pnpm run dev" } }), [])
  assert.deepEqual(expectedPorts("pnpm dev", { scripts: { dev: "pnpm serve", serve: "pnpm dev" } }), [])
  // A chain that terminates is followed all the way down.
  assert.deepEqual(ports(expectedPorts("pnpm dev", { scripts: { dev: "pnpm app", app: "astro dev" } })), [4321])
})

test("an unknown script yields nothing rather than a guess about its contents", () => {
  assert.deepEqual(expectedPorts("pnpm dev"), [])
  assert.deepEqual(expectedPorts("pnpm run dev", { scripts: { build: "vite build" } }), [])
  // Manager builtins are commands, not scripts, even when a script shares the name.
  assert.deepEqual(expectedPorts("pnpm install", { scripts: { install: "next dev" } }), [])
})

test("each framework default answers with its documented port, marked uncertain", () => {
  const cases: Array<[string, number]> = [
    ["next dev", 3000],
    ["vite", 5173],
    ["vite preview", 4173],
    ["astro dev", 4321],
    ["nuxt dev", 3000],
    ["ng serve", 4200],
    ["storybook dev", 6006],
    ["expo start", 8081],
    ["wrangler dev", 8787],
    ["gatsby develop", 8000],
    ["docusaurus start", 3000],
    ["remix dev", 3000],
    ["react-router dev", 3000],
    ["uvicorn app.main:app --reload", 8000],
    ["python manage.py runserver", 8000],
    ["./manage.py runserver", 8000],
    ["python -m uvicorn app:app", 8000],
    ["flask run", 5000],
    ["rails server", 3000],
    ["rails s", 3000],
    ["php artisan serve", 8000],
    ["npx next dev", 3000],
  ]
  for (const [cmd, port] of cases) {
    const guesses = expectedPorts(cmd)
    assert.equal(guesses.length, 1, cmd)
    assert.equal(guesses[0]!.port, port, cmd)
    assert.equal(guesses[0]!.certain, false, cmd)
  }
})

test("build and check subcommands do not serve, so they get no default", () => {
  assert.deepEqual(expectedPorts("next build"), [])
  assert.deepEqual(expectedPorts("vite build"), [])
  assert.deepEqual(expectedPorts("gatsby build"), [])
  assert.deepEqual(expectedPorts("pnpm build", { scripts: { build: "astro build" } }), [])
})

test("an explicit port is never shadowed by the framework default", () => {
  assert.deepEqual(expectedPorts("next dev --port 3011"), [
    { port: 3011, source: "explicit", evidence: "--port 3011", certain: true },
  ])
  assert.deepEqual(ports(expectedPorts("pnpm dev", { scripts: { dev: "vite --port 5199" } })), [5199])
})

test("the project's PORT beats a default, but only for tools that read it", () => {
  const env = { PORT: "4100" }
  assert.deepEqual(expectedPorts("next dev", { env }), [
    { port: 4100, source: "env", evidence: "PORT=4100", certain: true },
  ])
  // A bare node server almost always reads PORT; there is no default to fall back to.
  assert.deepEqual(ports(expectedPorts("node server.js", { env })), [4100])
  // vite ignores PORT, and claiming otherwise would be a certain-looking lie.
  assert.deepEqual(expectedPorts("vite", { env }), [
    { port: 5173, source: "default", evidence: "vite", certain: false },
  ])
  // A flag in the command still outranks the configured environment.
  assert.deepEqual(ports(expectedPorts("next dev --port 3011", { env })), [3011])
})

test("fan-out runners yield nothing rather than one confidently wrong port", () => {
  const scripts = { dev: "next dev" }
  assert.deepEqual(expectedPorts("turbo run dev", { scripts }), [])
  assert.deepEqual(expectedPorts("pnpm -r dev", { scripts }), [])
  assert.deepEqual(expectedPorts("pnpm --filter web dev", { scripts }), [])
  assert.deepEqual(expectedPorts("pnpm --parallel dev", { scripts }), [])
  assert.deepEqual(expectedPorts("lerna run dev", { scripts }), [])
})

test("chained commands contribute independently, deduped with the strongest evidence", () => {
  const guesses = expectedPorts("uvicorn app:app && next dev --port 8000")
  // Both name 8000; the explicit flag outranks uvicorn's default.
  assert.deepEqual(guesses, [{ port: 8000, source: "explicit", evidence: "--port 8000", certain: true }])
})

test("guesses come out certain first, then by ascending port", () => {
  const guesses = expectedPorts("vite ; node worker.js --port 9000 ; flask run")
  assert.deepEqual(
    guesses.map((guess) => [guess.port, guess.certain]),
    [
      [9000, true],
      [5000, false],
      [5173, false],
    ],
  )
})

test("quoted script names and wrappers do not hide the command", () => {
  // `hangar add --from-package-json` writes cmds like `pnpm run 'dev'`.
  assert.deepEqual(ports(expectedPorts("pnpm run 'dev'", { scripts: { dev: "next dev" } })), [3000])
  assert.deepEqual(ports(expectedPorts("cross-env NODE_ENV=dev PORT=4100 node server.js")), [4100])
  assert.deepEqual(ports(expectedPorts("npx -y wrangler dev")), [8787])
})

test("a command this module cannot read yields nothing at all", () => {
  assert.deepEqual(expectedPorts(""), [])
  assert.deepEqual(expectedPorts("make dev"), [])
  assert.deepEqual(expectedPorts('concurrently "next dev" "node worker.js"'), [])
})
