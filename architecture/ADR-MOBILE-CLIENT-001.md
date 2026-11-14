# ADR-MOBILE-CLIENT-001 — Flutter as the primary mobile client

- **Status:** Accepted by product owner
- **Decision date:** 2026-11-14
- **Scope:** InOne mobile applications for iOS and Android
- **Decision type:** Mobile client technology and platform integration

## Context

InOne is a cross-platform business application with messaging, files, notifications, CRM/workspace functionality and, in later product phases, task/calendar and AI-assisted workflows. The mobile client must provide a consistent product experience on iOS and Android while remaining maintainable by the current team.

The repository already contains an existing Flutter mobile application and a separately organized Dart UI source package. The imported Dart screens are source material for integration, not proof that the screens are production-ready or already connected to application state, repositories, APIs, or secure messaging.

The product requires more than fast screen rendering. Relevant quality attributes include responsiveness, reliability, accessibility, native OS integration, secure key handling, background execution, maintainability, and the cost of supporting two mobile platforms.

## Decision

1. **Flutter (Dart) is the primary framework for InOne's iOS and Android mobile clients.**
2. Continue the existing Flutter implementation. Do not initiate a wholesale rewrite to Kotlin Multiplatform or two fully native applications based only on general technology comparisons.
3. Keep the shared product UI and ordinary application logic in Flutter/Dart, following the repository's existing architecture and API contracts.
4. Where a platform capability requires deeper native integration, implement a narrow, reviewed native module or plugin in **Swift** (iOS) and/or **Kotlin** (Android), exposed through a documented Flutter platform boundary. Candidate areas include secure platform storage/key operations, background execution, push-notification integration, and other OS-specific capabilities. Native modules must not create an alternate source of truth for product or backend contracts.
5. Security-sensitive messaging and cryptographic operations must preserve the existing fail-closed requirements. No plaintext fallback, token logging, or unsafe key persistence is permitted.
6. Keep approved HTML reference screens as design/reference assets; do not restore HTML/WebView as the primary production UI merely to avoid Flutter integration work.
7. Do not add post-Beta features or alter backend/API contracts as a side effect of this technology decision.

## Alternatives considered

### Kotlin Multiplatform with native UI

Could share selected business/domain logic while using native UI frameworks on each platform. This is a credible future option if platform-specific requirements or measured Flutter limitations justify it. It introduces a different architecture and migration/integration cost; it is not selected for the current implementation.

### Fully native Swift and Kotlin applications

Offers direct access to platform APIs and maximum platform-specific UI control, but requires two client implementations and increases ongoing development, testing, and maintenance effort. Not selected for the current stage.

### React Native

A viable cross-platform alternative with a TypeScript ecosystem. Switching would require a rewrite or parallel client stack without a demonstrated product-specific advantage. Not selected.

## Validation and performance gates

This ADR does not claim that Flutter is universally faster than native development or that a measured performance improvement has already been achieved.

Before making quantitative performance claims, benchmark equivalent Flutter and (where useful) native implementations on the same representative devices, with equivalent data and network conditions. Record at least:

- cold and warm screen-open time;
- frame-time distribution and dropped/janky frames during scrolling and transitions;
- interaction-to-feedback latency;
- memory and CPU usage during representative sessions;
- chat-list and long-conversation behavior;
- file upload/download behavior;
- notification delivery and background-resume behavior;
- battery impact for sustained messaging/synchronization tests.

Separate rendering performance from network/server latency. Include device/OS versions, build mode, test data, repetitions, and measurement method in the report.

Reconsider this decision only if repeatable measurements or a concrete platform/security requirement show that Flutter cannot meet an agreed product requirement and a targeted native module is insufficient. Any reconsideration must be recorded as a new owner-approved ADR; do not silently migrate frameworks.

## Consequences

### Positive

- One primary UI and application codebase for iOS and Android.
- Preserves the existing Flutter investment and imported Dart UI work.
- Consistent design system and behavior across platforms.
- Retains access to native capabilities through explicit platform boundaries when needed.

### Trade-offs and obligations

- The team must understand Flutter lifecycle, rendering, state management, and platform-channel/plugin boundaries.
- Native expertise remains necessary for selected OS integrations.
- Imported screens require proper integration with repositories, state, navigation, API contracts, accessibility, localization, and automated tests before production use.
- Performance must be measured on real target devices; framework choice alone does not guarantee smoothness or efficiency.

## Owner approval

The product owner explicitly approved the recommendation to retain Flutter as the primary mobile framework, use native Swift/Kotlin modules selectively for platform-specific capabilities, and validate performance through comparable device benchmarks before considering a framework change.
