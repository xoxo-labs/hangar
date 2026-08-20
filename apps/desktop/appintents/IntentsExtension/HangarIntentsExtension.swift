// Scaffolded by @xoxo/appintents-codegen v0.2.0 — yours to edit; regeneration never touches this file.

import AppIntents
import ExtensionFoundation

/// The production App Intents surface: this process runs your intents when
/// the app itself isn't (or shouldn't be) launched. It has its own dependency
/// table, so it registers the same collaborators the app does (RFC 09 §3.0) —
/// swap in your real providers and handlers here as you do there.
@main
struct HangarIntentsExtension: AppIntentsExtension {
    init() {
        // No store override, unlike the dev host: an appex is sandboxed, so
        // the App Group container is the only store it can reach. Same
        // process provider as the dev host, so Siri suggests only startable
        // processes in both.
        GeneratedDependencies.register(
            processProvider: HangarProcessProvider(),
            handlers: HangarHandlers()
        )
    }
}
