# InOne Beta 1.0 — Development Environment Constraints

**Recorded:** 2026-11-12  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Active development stage:** Beta 1.0

## Owner-confirmed workstation constraints

The current development workstation is a Dell XPS 13 running Windows 10, with Visual Studio Code, Visual Studio, Android Studio, and a configured GigaChat agent installed.

The owner does not currently recall the exact installed RAM capacity. For planning and resource budgeting, use **8 GB RAM as the conservative baseline**. This is a development-environment constraint, not a claim that the laptop's actual RAM has been measured.

Available free disk space is approximately **10 GB out of 512 GB**. Treat 10 GB as a hard ceiling for any proposed local development activity until the owner reports otherwise.

The workstation also hosts a large Flutter build/project for Propo. Do not assume its SDKs, caches, build outputs, or project files are disposable or available for InOne.

## Operating rules

1. Do not run full Flutter builds, large Android builds, broad dependency downloads, or parallel heavy test suites on this workstation while free disk space remains around 10 GB.
2. Do not install a persistent self-hosted GitHub Actions runner on this workstation at this time.
3. Do not delete, relocate, or globally clean Flutter, Dart, Gradle, Android SDK, Visual Studio, or Propo files/caches without first inspecting their size, ownership, and impact and obtaining owner approval where destructive.
4. Prefer low-resource work: source review, code edits, documentation, configuration review, targeted static checks, and small tests only when their resource requirements are known to fit.
5. Do not claim a test, build, code generation, or platform validation passed unless it was actually executed and its result is available. Mark unavailable checks as NOT RUN / BLOCKED, with the reason.
6. Keep mobile product quality independent from workstation limitations. The app must still be designed and validated for a range of real mobile-device resource profiles; the workstation's 8 GB planning baseline is not a device minimum or a product requirement.
7. Preserve the current GitHub billing safety posture: do not increase budgets, disable usage-blocking safeguards, add a payment method, or incur paid usage without explicit owner authorization.
8. Keep native MLS disabled (`INONE_MLS_NATIVE_ENABLED=false`) until the relevant acceptance checks have actually passed on a functioning runner.

## Future Linux build server

The owner intends to build a dedicated Linux server when resources permit. At that point, assess and migrate heavyweight CI workloads there, including Rust/OpenMLS, Flutter Rust Bridge, Flutter/Android builds, integration tests, and a self-hosted runner where appropriate.

Until that server exists, do not treat it as available and do not make it a prerequisite for lightweight source-level work. Keep GitHub as the source of truth for code, review, CI evidence, and archived development decisions.

## Status

These are owner-confirmed operational constraints and planning rules. They do not constitute a test result, CI acceptance, or a change to Beta 1.0 scope/WBS. Stage 4 remains subject to its existing acceptance gate; no merge is authorized by this record.
