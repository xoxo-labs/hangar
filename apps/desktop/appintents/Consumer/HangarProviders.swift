import Foundation

/// Consumer side of the data seam (voicecraft RFC 09 §3.2). Projects use
/// the generated file provider untouched; processes add the one piece of
/// app logic the envelope can't know: Start is the only exposed verb, so
/// the picker suggests only processes that are actually startable.
struct HangarProcessProvider: ProcessProvider {
    private let store = ProcessFileProvider(directory: HangarIntents.storeDirectory)

    func records() async throws -> [ProcessRecord] {
        try await store.records()
    }

    func suggestedRecords() async throws -> [ProcessRecord] {
        try await records().filter { $0.state != "running" }
    }
}
