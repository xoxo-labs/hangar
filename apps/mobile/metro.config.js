// Monorepo metro: the workspace packages (@hangar/contracts, @hangar/client-core)
// ship raw TypeScript through `exports`, so metro has to watch the repo root and
// honour package exports to resolve them.
const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]
// Note: hierarchical lookup stays ON. pnpm gives every package its own
// node_modules inside the store (`.pnpm/<pkg>/node_modules/<dep>`), so a
// dependency of a dependency is only reachable by walking up from the importing
// file — the `disableHierarchicalLookup` recipe that suits hoisted (npm/bun)
// monorepos makes metro fail here with "Unable to resolve module".
config.resolver.unstable_enablePackageExports = true

module.exports = config
