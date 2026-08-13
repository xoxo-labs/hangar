import Foundation

/// Effects seam (voicecraft RFC 09 §3.3): every handler posts a command
/// file and returns immediately with honest "starting" wording — the
/// envelope's dialogs say "Starting …", not "Started …", because the
/// effect is asynchronous by design.
struct HangarHandlers: IntentHandlers {
    func startProcess(process: ProcessRecord) async throws -> ProcessRecord {
        try HangarCommandChannel.post(kind: "start-process", targetId: process.id)
        return process
    }

    func startProject(project: ProjectRecord) async throws -> StartProjectResult {
        let startable = try await HangarProcessProvider().records()
            .filter { $0.project == project.name && $0.state != "running" }
        try HangarCommandChannel.post(kind: "start-project", targetId: project.id)
        return StartProjectResult(started: startable.count)
    }
}
