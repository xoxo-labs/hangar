import AppKit
import Foundation

/// Hangar-side constants shared by the consumer files.
enum HangarIntents {
    static let appGroup = "group.works.xoxo.hangar"
    /// The Electron app's bundle id — NOT the dev host's.
    static let hangarBundleId = "works.xoxo.hangar"

    /// Dev host points this at the dev server's HANGAR_HOME before
    /// registering providers; production (sandboxed appex) leaves it nil
    /// and uses the App Group container.
    nonisolated(unsafe) static var storeOverride: URL?

    static var storeDirectory: URL {
        storeOverride ?? EntityStore.appGroupContainer(appGroup)
    }

    static var commandsDirectory: URL {
        let dir = storeDirectory.appendingPathComponent("Commands", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true)
        return dir
    }
}

/// One queued instruction for the Hangar server. The file is the contract:
/// Swift writes it, the server's watcher consumes and deletes it. Commands
/// survive the app not running — they wait on disk until a server appears.
struct HangarCommand: Codable {
    let kind: String
    let targetId: String
    let issuedAt: Date
}

enum HangarCommandChannel {
    static func post(kind: String, targetId: String) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(
            HangarCommand(kind: kind, targetId: targetId, issuedAt: Date()))
        let file = HangarIntents.commandsDirectory
            .appendingPathComponent("\(UUID().uuidString).json")
        try data.write(to: file, options: .atomic)
        launchHangarIfNeeded()
    }

    /// Best effort: in dev the Electron app isn't installed as a bundle and
    /// `pnpm dev`'s server consumes commands instead, so a missing app is
    /// not an error.
    private static func launchHangarIfNeeded() {
        let running = NSRunningApplication.runningApplications(
            withBundleIdentifier: HangarIntents.hangarBundleId)
        guard running.isEmpty else { return }
        guard let url = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: HangarIntents.hangarBundleId)
        else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: .init())
    }
}
