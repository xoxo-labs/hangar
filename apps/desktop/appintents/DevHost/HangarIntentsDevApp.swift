import AppIntents
import SwiftUI

/// Development host: compiles the App Intents surface in-process so
/// Spotlight/Shortcuts can discover and run it without the Electron app or
/// an appex. Production embeds the same Generated/ + Consumer/ sources in
/// an extension inside Hangar.app instead.
@main
struct HangarIntentsDevApp: App {
    init() {
        // Share the dev server's home (pnpm dev runs with
        // HANGAR_HOME=~/.hangar-dev) instead of the App Group container,
        // so the dev host needs no provisioning profile.
        HangarIntents.storeOverride = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent(".hangar-dev/appintents", isDirectory: true)
        GeneratedDependencies.register(
            projectProvider: ProjectFileProvider(directory: HangarIntents.storeDirectory),
            processProvider: HangarProcessProvider(),
            handlers: HangarHandlers()
        )
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var projects: [ProjectRecord] = []
    @State private var processes: [ProcessRecord] = []
    @State private var lastOpenRequest = "none yet"

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Hangar Intents — dev host").font(.title3.bold())
            Text("Store: \(HangarIntents.storeDirectory.path)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text("Last open request: \(lastOpenRequest)")
                .font(.caption)

            List {
                Section("Projects (\(projects.count))") {
                    ForEach(projects) { project in
                        VStack(alignment: .leading) {
                            Text(project.name)
                            Text(project.status)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Processes (\(processes.count))") {
                    ForEach(processes) { process in
                        HStack {
                            Text(process.qualifiedName)
                            Spacer()
                            Text(process.state).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Button("Reload store") { Task { await reload() } }
        }
        .padding()
        .frame(minWidth: 500, minHeight: 460)
        .task { await reload() }
        .onReceive(
            NotificationCenter.default.publisher(for: OpenRequests.notification)
        ) { _ in
            if let pending = OpenRequests.consumePending() {
                lastOpenRequest = "\(pending.entityType) \(pending.id)"
            }
        }
    }

    private func reload() async {
        projects = (try? await ProjectFileProvider(
            directory: HangarIntents.storeDirectory).records()) ?? []
        processes = (try? await HangarProcessProvider().records()) ?? []
    }
}
