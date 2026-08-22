import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  appendSegment,
  asDirectory,
  type BrowseEntry,
  canGoUp,
  compareBrowseEntries,
  directoryPart,
  hasTrailingSeparator,
  leafPart,
  parentPath,
} from "./browsePath.logic.ts"

describe("hasTrailingSeparator", () => {
  it("is true for a path that names a directory", () => {
    assert.equal(hasTrailingSeparator("~/"), true)
    assert.equal(hasTrailingSeparator("~/code/"), true)
    assert.equal(hasTrailingSeparator("/"), true)
    assert.equal(hasTrailingSeparator("/Users/sorin/"), true)
  })

  it("is false while the last segment is still a filter prefix", () => {
    assert.equal(hasTrailingSeparator("~/co"), false)
    assert.equal(hasTrailingSeparator("code"), false)
    assert.equal(hasTrailingSeparator("/Users/sorin"), false)
  })

  it("treats a bare ~ as the home directory, not a prefix", () => {
    assert.equal(hasTrailingSeparator("~"), true)
  })

  it("is false for an empty path", () => {
    assert.equal(hasTrailingSeparator(""), false)
  })

  it("reads a backslash as a separator too", () => {
    assert.equal(hasTrailingSeparator("~\\code\\"), true)
    assert.equal(hasTrailingSeparator("~\\code"), false)
  })
})

describe("directoryPart", () => {
  it("keeps the separator that ends it", () => {
    assert.equal(directoryPart("~/co"), "~/")
    assert.equal(directoryPart("~/code/"), "~/code/")
    assert.equal(directoryPart("/Users/sorin"), "/Users/")
    assert.equal(directoryPart("/Users/sorin/"), "/Users/sorin/")
  })

  it("is empty when nothing typed yet names a directory", () => {
    assert.equal(directoryPart("code"), "")
    assert.equal(directoryPart(""), "")
  })

  it("expands a bare ~ into the home directory", () => {
    assert.equal(directoryPart("~"), "~/")
  })

  it("holds at a root", () => {
    assert.equal(directoryPart("/"), "/")
    assert.equal(directoryPart("/Users"), "/")
  })

  it("collapses repeated separators instead of yielding empty segments", () => {
    assert.equal(directoryPart("~//code"), "~/")
    assert.equal(directoryPart("~//code//"), "~/code/")
    assert.equal(directoryPart("//Users//sorin"), "/Users/")
  })

  it("reads backslashes but writes forward slashes", () => {
    assert.equal(directoryPart("~\\code\\hangar"), "~/code/")
    assert.equal(directoryPart("~\\code\\"), "~/code/")
  })
})

/** The normalized form the split reassembles into: the path itself, except that a bare "~" gains its separator. */
const asDirectoryOrSelf = (path: string): string => (path === "~" ? "~/" : path)

describe("leafPart", () => {
  it("is the prefix being typed", () => {
    assert.equal(leafPart("~/co"), "co")
    assert.equal(leafPart("code"), "code")
    assert.equal(leafPart("/Users/sorin"), "sorin")
  })

  it("is empty once the path names a directory", () => {
    assert.equal(leafPart("~/code/"), "")
    assert.equal(leafPart("~"), "")
    assert.equal(leafPart("/"), "")
    assert.equal(leafPart(""), "")
  })

  it("survives repeated and backslash separators", () => {
    assert.equal(leafPart("~//code"), "code")
    assert.equal(leafPart("~\\code"), "code")
  })

  it("rebuilds the path when joined back onto the directory part", () => {
    for (const path of ["~/co", "~/code/", "code", "/Users/sorin", "/", ""]) {
      assert.equal(directoryPart(path) + leafPart(path), asDirectoryOrSelf(path))
    }
  })
})

describe("appendSegment", () => {
  it("replaces the typed prefix and leaves a trailing separator", () => {
    assert.equal(appendSegment("~/co", "code"), "~/code/")
    assert.equal(appendSegment("~/code/", "hangar"), "~/code/hangar/")
    assert.equal(appendSegment("/Users/so", "sorin"), "/Users/sorin/")
  })

  it("works from an empty path and from a path with no separator at all", () => {
    assert.equal(appendSegment("", "Users"), "Users/")
    assert.equal(appendSegment("co", "code"), "code/")
  })

  it("works from a bare ~ and from a root", () => {
    assert.equal(appendSegment("~", "code"), "~/code/")
    assert.equal(appendSegment("/", "Users"), "/Users/")
  })

  it("does not double up separators the name brought with it", () => {
    assert.equal(appendSegment("~//", "code"), "~/code/")
    assert.equal(appendSegment("~/", "/code/"), "~/code/")
    assert.equal(appendSegment("~/", "code\\"), "~/code/")
  })

  it("leaves the directory alone for an empty name", () => {
    assert.equal(appendSegment("~/co", ""), "~/")
    assert.equal(appendSegment("~/co", "/"), "~/")
  })
})

describe("parentPath", () => {
  it("drops the last segment of a directory", () => {
    assert.equal(parentPath("/Users/"), "/")
    assert.equal(parentPath("/Users/sorin/"), "/Users/")
    assert.equal(parentPath("~/code/"), "~/")
  })

  it("strips a trailing separator first, so a half-typed leaf has the same parent", () => {
    assert.equal(parentPath("/Users/sorin"), "/Users/")
    assert.equal(parentPath("/Users/sorin/"), "/Users/")
    assert.equal(parentPath("~/co"), "~/")
  })

  it("is null at a root, with home counted as one", () => {
    assert.equal(parentPath("/"), null)
    assert.equal(parentPath("~"), null)
    assert.equal(parentPath("~/"), null)
  })

  it("is null when there is no directory above to name", () => {
    assert.equal(parentPath(""), null)
    assert.equal(parentPath("code"), null)
  })

  it("survives repeated and backslash separators", () => {
    assert.equal(parentPath("~//code//"), "~/")
    assert.equal(parentPath("//Users//sorin"), "/Users/")
    assert.equal(parentPath("~\\code\\hangar"), "~/code/")
  })
})

describe("canGoUp", () => {
  it("offers the row while a directory below a root is listed", () => {
    assert.equal(canGoUp("~/code/"), true)
    assert.equal(canGoUp("/Users/"), true)
    assert.equal(canGoUp("/Users/sorin/"), true)
  })

  it("withholds it at a root", () => {
    assert.equal(canGoUp("/"), false)
    assert.equal(canGoUp("~"), false)
    assert.equal(canGoUp("~/"), false)
  })

  it("withholds it while the last segment is a filter prefix", () => {
    assert.equal(canGoUp("~/code/han"), false)
    assert.equal(canGoUp("/Users/sorin"), false)
    assert.equal(canGoUp("code"), false)
    assert.equal(canGoUp(""), false)
  })
})

describe("asDirectory", () => {
  it("adds the separator a selected path is missing", () => {
    assert.equal(asDirectory("/Users/sorin"), "/Users/sorin/")
    assert.equal(asDirectory("~/code"), "~/code/")
    assert.equal(asDirectory("code"), "code/")
  })

  it("leaves a directory as it is", () => {
    assert.equal(asDirectory("/Users/sorin/"), "/Users/sorin/")
    assert.equal(asDirectory("/"), "/")
    assert.equal(asDirectory("~/"), "~/")
  })

  it("turns a bare ~ into the home directory", () => {
    assert.equal(asDirectory("~"), "~/")
  })

  it("keeps an empty path empty rather than jumping to the filesystem root", () => {
    assert.equal(asDirectory(""), "")
  })

  it("normalizes repeated and backslash separators", () => {
    assert.equal(asDirectory("~//code"), "~/code/")
    assert.equal(asDirectory("~\\code\\hangar"), "~/code/hangar/")
  })
})

describe("compareBrowseEntries", () => {
  const entry = (name: string, marks: Partial<BrowseEntry> = {}): BrowseEntry => ({
    name,
    git: marks.git ?? false,
    pkg: marks.pkg ?? false,
  })
  const sorted = (entries: BrowseEntry[]): string[] =>
    [...entries].sort(compareBrowseEntries).map((candidate) => candidate.name)

  it("sorts project-looking directories above plain ones", () => {
    assert.deepEqual(sorted([entry("zzz"), entry("aaa", { git: true }), entry("mmm"), entry("nnn", { pkg: true })]), [
      "aaa",
      "nnn",
      "mmm",
      "zzz",
    ])
  })

  it("counts either mark as project-looking", () => {
    assert.equal(compareBrowseEntries(entry("b", { git: true }), entry("a")), -1)
    assert.equal(compareBrowseEntries(entry("b", { pkg: true }), entry("a")), -1)
    assert.equal(compareBrowseEntries(entry("a"), entry("b", { git: true, pkg: true })), 1)
  })

  it("breaks ties alphabetically within each group", () => {
    assert.deepEqual(sorted([entry("beta"), entry("alpha"), entry("gamma")]), ["alpha", "beta", "gamma"])
    assert.deepEqual(sorted([entry("beta", { git: true }), entry("alpha", { git: true })]), ["alpha", "beta"])
  })

  it("ignores case when comparing names", () => {
    assert.deepEqual(sorted([entry("Zed"), entry("apple"), entry("Banana")]), ["apple", "Banana", "Zed"])
  })

  it("stays total, so names differing only in case keep a fixed order", () => {
    assert.equal(compareBrowseEntries(entry("Code"), entry("code")), -1)
    assert.equal(compareBrowseEntries(entry("code"), entry("Code")), 1)
    assert.equal(compareBrowseEntries(entry("code"), entry("code")), 0)
  })
})
