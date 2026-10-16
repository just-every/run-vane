# Source custody

Started from the committed Base foundation at
`fc0e1041efa55771142bbb57c4ab4743147e264d`, converted to package mode with RER
0.2.17. `composition.lock.json` records foundation copies; domain additions are
edition-owned. The package pin is now RER 0.2.30, and every Base copy recorded
in `base-copies.json` (modules, `src/base`, edition-authoring scripts and
`run-demo.yml`) is refreshed from rer-v0.2.30
(`d434ea67989fe10b6ddff01daba8bb350975e54a`).

Adapted MIT sibling source:

- Spool `src/domain/origins.ts` at
  `9f75f060a66446f4c9dcf9cafddd0906d7698748`: canonical origins in
  `src/vane/privacy.ts`. Its admission and retention informed atomic fences.
  Free-text scrubbing is replaced with explicit approved analytics labels.
- Uptime `src/domain/schedule.ts` at
  `c699a67fa0358f79b736c27b7657a9189afaa9f4`: grid helpers in
  `src/vane/reports.ts` align comparison windows.
- Mango `src/core/features/insights/service.ts` at
  `7f27217b8ce03aeac9cf4eb3fa0c8eb7ebc28d3f`: evidence/time-window service
  structure in `src/vane/reports.ts`. Its contact/IP consent schema is replaced
  with event consent provenance without person identity.

Read package-mode examples run-coaster `3cdb77f`, run-beam `9029728` and run-pier
`dcd4c59`. No sibling repository was changed.

The exact published RER 0.2.17 package supplies bounded, nonblocking macOS listener ownership inspection. No local RER patches are applied.
