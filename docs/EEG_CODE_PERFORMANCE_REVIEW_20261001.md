# EEG code and performance review — 2026-10-01

The inspected gallery, authoring controls and homepage changes are implemented and pass their focused checks. Local measurements confirm fewer card renders, no repeated image-signing operations on cache hits, and less decorative canvas work. External performance after these changes has not been measured.

## Gallery rendering and image delivery

Memoized gallery cards receive stable item objects and callbacks, with primitive review-state and image-URL props. The local React profile for initial loading, opening one example and changing one review status fell from 489 card renders to 164: 163 initial cards plus the changed card. This profile used the earlier 163-item manifest; the final manifest contains 166 examples. Opening the viewer does not rerender unchanged cards. Thumbnails remain lazy; full PNGs load in the viewer.

The signing cache shares one in-flight promise and signs thumbnails and full images in two parallel batches. It refreshes ten minutes before the three-hour token expiry, rejects batch and per-object failures, retries failed requests, and prevents an older rejection from clearing a newer entry. Editor authorization runs before cache access; review states and note counts remain fresh, with `private, no-store` responses. The process cache contains common image URLs, and reuse depends on a warm server instance.

| Final signing measurement, 166 examples / 332 paths | Time | Signing operations |
|---|---:|---:|
| Cold | 323.482 ms | 2 |
| Warm, first repeat | 0.006 ms | 0 |
| Warm, second repeat | 0.001 ms | 0 |

These isolated public-HTTPS measurements ran from the Windows desktop, outside an off-LAN browser test. Authentication, live review queries and image transfer are additional work. Earlier endpoint samples measured gallery HTML at 18–101 ms, a 66 KB thumbnail at 314 ms and a 334 KB full PNG at 345 ms; live state/note queries ranged approximately 193–636 ms. These samples do not establish user-facing page-load guarantees.

## Homepage work and external baseline

The Navbar wordmark uses `loading="eager"` and `fetchPriority="high"`, consistent with installed Next 16 image documentation. HeroEEG pauses when offscreen or the document is hidden and caps drawing at approximately 30 frames/second. Its existing waveforms, spatial sampling, event timing and static reduced-motion composition remain intact. Resume avoids a catch-up jump; unmount cancels animation and removes listeners.

The finite fixture executes the actual component code with controlled RAF, visibility events and canvas spies:

| Visible workload, 10 seconds | Before | After |
|---|---:|---:|
| 1200 px / 60 Hz: draws | 600 | 300 |
| 1200 px / 60 Hz: sine calls | 20,058,431 | 10,029,231 |
| 1200 px / 60 Hz: instrumented JavaScript time | 2154.857 ms | 1184.300 ms |
| 1920 px / 120 Hz: draws | 1200 | 300 |
| 1920 px / 120 Hz: sine calls | 64,131,991 | 16,032,981 |
| 1920 px / 120 Hz: instrumented JavaScript time | 6635.288 ms | 1711.575 ms |

Offscreen and hidden phases produce zero draws, waveform sine calls and scheduled animation callbacks. Visible resume produces 30 draws/second; reduced motion produces one static draw with no animation. Unmount leaves no callbacks or window/document listeners. Local browser inspection confirmed homepage appearance, eager/high wordmark attributes and scrolling away/back. The fixture covers hidden-page and reduced-motion behavior. Instrumented timings exclude real rasterization, shadows and GPU work; operation reductions are deterministic, but these times are not browser CPU or PageSpeed measurements.

Before-change external [home PageSpeed](https://pagespeed.web.dev/analysis/https-pedquest-org/isafgdo7st?form_factor=mobile) recorded mobile score 87, FCP 0.9 s, LCP 4.0 s, TBT 20 ms and CLS 0 under emulated Moto G Power / slow 4G. The wordmark was the LCP element. [Desktop](https://pagespeed.web.dev/analysis/https-pedquest-org/isafgdo7st?form_factor=desktop) recorded score 71, FCP 0.2 s, LCP 0.8 s, TBT 980 ms, 15.9 s main-thread work and 20 long tasks. The [public question bank](https://pagespeed.web.dev/analysis/https-pedquest-org-education-question-bank/q197atet1j?form_factor=mobile) recorded mobile score 92, FCP 1.8 s, LCP 3.1 s, TBT 0 ms and CLS 0. These are single external lab runs; the authenticated gallery was not measured through public PageSpeed. External preview testing on October 1 at 00:52 EDT used [Google PageSpeed](https://pagespeed.web.dev/analysis/https-pedquest-site-8h657gmba-craigpress-vercel-app/3nmadqlcou): mobile score 87, FCP 0.9 s, LCP 3.9 s, TBT 100 ms, CLS 0, speed index 2.4 s; desktop score 100, FCP 0.2 s, LCP 0.5 s, TBT 10 ms, CLS 0, speed index 0.6 s. Mobile performance score was unchanged; desktop improved in this run. These are single lab runs on different production/preview hostnames and cannot isolate code changes from CDN, deployment and run variability. The authenticated gallery still requires post-rollout external verification.

## Authoring integration and clinical limits

Ciganek and bilateral-independent SeLECTS options, schema controls, guide entries and image-spec documentation agree. TypeScript and Python warn when selected versions ignore train duration, triphasic centrotemporal morphology, POSTS intervals or optional spindle field/K-complex delay. Valid author bounds are tested. Legacy Ciganek support and existing defaults remain intact; teaching delays are documented without implying a universal physiological rule.

The final rescaled average-reference atypical-absence and LGS examples, frontal attenuation with preserved EMG, tonic muscle increase and paired SeLECTS montages have been visually reviewed. The SeLECTS pair shows independent sides and the expected centrotemporal-negative/frontal-positive tangential field. These remain educational synthetic examples; visual comparison and numerical checks establish the reviewed features, not clinical validation of every possible generated setting. Per-example clinical findings and reference-comparison limits are recorded separately.

## Verification and dependencies

- 24 cache/spec/guide TypeScript tests passed; final Node-reported duration 1057.678 ms. Typecheck passed in 2.994 seconds; whitespace checks passed.
- 59 targeted renderer tests passed, with zero failures/errors/skips, in 339.40 seconds during concurrent bank rendering. Coverage includes muscle preservation, neonatal suppression/graphoelements, spindle/K-complex defaults and controls, seven accepted generalized-example digests, Ciganek/SeLECTS, version warnings and partition determinism. This duration is not a standalone renderer benchmark; bank-migration checks are tracked separately.
- Next is locked at 16.3.6; fast-uri at 3.1.8; compatible dev-only brace-expansion locks are 1.1.21 and nested 5.0.12. Full and production npm audits report zero vulnerabilities. The worktree has an independent dependency directory; the original canonical dependency target was preserved.

Evidence artifacts: `signing-cache-performance.json`, `performance-baseline.json`, `external-performance.json`, `work/canvas-before-performance.json`, `work/canvas-after-performance.json`, `work/final-regression-py.xml`, `work/dependency-verification.json` and `work/dependency-audit-after-{all,prod}.json`. Build/deployment results and post-change external measurements are separate from these local checks.
