# Viewer spike — EEG Teaching Lab raw + qEEG panes

Date: 2026-09-12. Scope: pick the rendering/streaming substrate for the in-browser EEG viewer
(raw pane + qEEG trend strip, shared time cursor, event marks). Evaluated from source and package
registries, not from marketing pages. Nothing in `src/` or `tools/` was touched.

---

## 1. Recommendation

**Adopt Epicurrents for the raw pane — as a library (`@epicurrents/core` reader + trend + plot
layer) mounted inside our own React chrome — not as an embedded application.**

Four verified facts drove this:

1. **It already does HTTP range streaming of EDF.** `GenericSignalReader._readPartFromFile()`
   computes byte offsets from EDF data-record boundaries and issues
   `Range: bytes=<start>-<end>` with `Accept-Encoding: identity`, per chunk, with an
   abort-signal-aware op queue and a circuit-breaker fetch wrapper.
   ([core/src/assets/reader/GenericSignalReader.ts#L381](https://github.com/epicurrents/core/blob/main/src/assets/reader/GenericSignalReader.ts#L381))
   This is present in the **published** build too, not just on `main`
   (`dist/assets/reader/GenericSignalReader.js:301` in the
   [@epicurrents/core 1.0.3 tarball](https://registry.npmjs.org/@epicurrents/core/-/core-1.0.3.tgz)).
   Nothing else surveyed streams EDF. This is the requirement that kills whole-file designs at
   930 MB, and it is the single most expensive thing to write ourselves.

2. **It already computes the qEEG trends** — contradicting the brief's assumption that nothing
   surveyed does. `BiosignalTrendType = 'amplitude' | 'pdbsi' | 'ratio' | 'spectrogram'`
   ([core/src/types/biosignal.ts#L1747](https://github.com/epicurrents/core/blob/main/src/types/biosignal.ts#L1747)),
   implemented in `TrendProcessor` with a real aEEG epoch function, a reusable FFT cache for
   spectrogram/ratio/pdBSI, common-average-reference scratch buffers, and gap-aware epoching
   ([TrendProcessor.ts](https://github.com/epicurrents/core/blob/main/src/assets/biosignal/service/TrendProcessor.ts)).
   All of it ships in 1.0.3 (`dist/assets/biosignal/service/TrendProcessor.js`,
   `dist/workers/trend.worker.js`, `umd/trend.worker.js`).

3. **The waveform renderer in the published version is framework-agnostic and DOM-mounting.**
   `@epicurrents/core/plots` exports `WebGlPlot`, `CanvasPlot`, `WebGlPlotTrace`, `PlotColor`;
   `WebGlPlot` creates its own canvas, calls `getContext('webgl')`, and exposes
   `addTo(container: HTMLElement)`. No Vue reference anywhere in `dist/plots` (verified by grep of
   the 1.0.3 tarball). That is exactly the shape a React `ref` callback needs.

4. **Apache-2.0 throughout**, on every repo in the org that declares a licence
   ([github.com/epicurrents](https://github.com/epicurrents)). Paper:
   Lohi S, Julkunen P, Kälviäinen R, Mervaala E. *An open-source JavaScript clinical
   neurophysiology library for education and clinical research.* Clin Neurophysiol Pract
   2026;11:115-125. [PMID 41717536](https://pubmed.ncbi.nlm.nih.gov/41717536/),
   PMC12914546, doi:10.1016/j.cnp.2026.02.001 (citation confirmed against PubMed esummary).

The alternative — build custom — means writing an EDF record decoder, a range/chunk cache, a
WebGL trace renderer, **and** aEEG/spectrogram/pdBSI maths, all of which exist here under a
permissive licence. That is not a good trade for a teaching lab.

**What "adopt" does not mean.** We do *not* embed the Epicurrents application. `Epicurrents.launch()`
hard-fails without a registered interface — *"Cannot launch app before an interface has been
registered"*
([core/src/index.ts](https://github.com/epicurrents/core/blob/main/src/index.ts)) — and the only
interface that exists is a Vue 3 + Vuex + vue-i18n + webawesome app
([epicurrents/interface](https://github.com/epicurrents/interface)) whose npm package is
`"private": true` and unpublished. Embedding it would put a second framework and a foreign design
system inside a dark-only, CSS-custom-property page, and would push the shared time cursor across a
framework boundary. We consume the layer below it.

**Kill criterion.** If the phase-0 spike (below) cannot get a range-streamed EDF drawing into a
React container inside ~2 days, fall back to custom and port Neurosift's `RemoteFile` pattern
(§4) instead. That fallback is cheap to reach because the adapter boundary in §5 is the same either
way.

---

## 2. Comparison

| | **Epicurrents** | **squiggly** | **Neurosift** | **bdsp-core/timeline-viewer** |
|---|---|---|---|---|
| Licence | Apache-2.0 | **NONE — all rights reserved** | Apache-2.0 | **CC BY-NC 4.0** ("Commercial use is prohibited") |
| Language / stack | TypeScript, framework-agnostic core; Vue 3 interface | TypeScript, Next 14.2 + React 18.3 | TypeScript, Vite + React | JavaScript, Create React App + backend |
| npm-published | Partial — 3 of 20 repos; core 1.0.3 current, reader/module 2.5 yr stale | No (`private: true`) | No (app, not a library) | No |
| Partial / range loading | **Yes** — `Range: bytes=` per EDF record chunk, in published dist | **No** — `supabase.storage.download(filePath)`, whole file | **Yes** — chunked `Range:` + read-ahead cache | Not assessed (see §4) |
| Embeddability | Good at library level (`WebGlPlot.addTo(el)`); app level is Vue-only | Poor — chart is 294 LOC bound to chart.js + a custom annotation plugin, no separate package | N/A (reference only) | N/A (reference only) |
| Worker / WASM needs | 3 workers (montage, trend, memory-manager); SAB optional with published fallbacks; no `.wasm` in the tarball | None | Workers + WASM (HDF5) | Not assessed |
| qEEG / trend display | **Computes** aEEG, spectrogram, ratio, pdBSI — but does not draw them (see §6) | None | None | Event timeline only |
| Maintenance signal | Very active but **bus factor 1** — `sam-19` is the sole committer on all 20 repos (734 commits on core); **0 releases, 0 tags** anywhere; 0 open issues; 2 stars | 1 contributor (145 commits), 30 stars, 7 open issues, active | 10+ contributors (magland 462, bendichter 198, h-mayorquin 96), 65 stars, 58 open issues | **6 commits total**, 2 contributors, last push 2026-05-24, 0 stars |

Licence corrections to the brief, both verified:

- **squiggly is not MIT.** `package.json` carries no `license` field and is `"private": true`;
  there is no `LICENSE` file; the README has no licence section; GitHub's licence endpoint returns
  404 for [alexdni/squiggly](https://github.com/alexdni/squiggly). With no licence grant, default
  copyright applies — we may read it for ideas but must not copy code from it. It is also on
  React 18 / Next 14, one major behind us, and loads whole files from Supabase Storage, so it is not
  a viable fallback for a 930 MB recording in any case.
- **bdsp-core/timeline-viewer is CC BY-NC 4.0**, stated in
  [LICENSE.txt](https://github.com/bdsp-core/timeline-viewer/blob/main/LICENSE.txt) as *"Commercial
  use is prohibited."* A NonCommercial CC licence is unsuitable for software and incompatible with
  a site that may be institutionally or commercially deployed. **Do not vendor or copy it.** Its
  README is unmodified Create React App boilerplate and the repo has 6 commits total, so there is
  little to learn from it anyway. The event/annotation timeline layer is ours to write.

---

## 3. The Epicurrents maintenance picture, stated plainly

Verified from the GitHub and npm APIs on 2026-09-12:

- 20 repos in the org. **`sam-19` (Sampsa Lohi) is the only contributor to every one of them** —
  core 734, eeg-module 203, edf-reader 183, interface 166, builder 79, platform 40. No public org
  members. Bus factor 1.
- Cadence is genuinely high and current: core's last 100 commits span 2026-04-11 → 2026-09-10
  (7/15/19/25/28 per month Apr–Aug). `platform` was created 2026-09-04 and already has 40 commits.
  This is a live project, not an abandoned one.
- **No GitHub releases and no tags on any repo**, and 0 open issues org-wide (30 PRs total). There
  is no external user base shaking out bugs, and no upstream version to pin against.
- **npm publishing is partial and internally inconsistent.** Only `@epicurrents/core` (1.0.3,
  2026-08-04), `@epicurrents/edf-reader` (0.2.0-0, **2024-03-13**), `@epicurrents/eeg-module`
  (0.1.1-8, **2024-02-18**) and `@epicurrents/pyodide-service` (0.1.0, 2024-04-19) exist. The other
  16 return 404. Worse, the published `edf-reader` depends on `@epicurrents/core@^0.2.0-1` and the
  published `eeg-module` on `^0.1.3-8` — **neither is installable against core 1.0.3.**

**Consequence:** `npm install` cannot produce a working current Epicurrents EDF stack today. The
supported path is the [builder](https://github.com/epicurrents/builder) repo, which clones each
package, builds in dependency order, and pins exact commits in a manifest
(`npm run setup -- --manifest <file>`; `npm run build:edition -- --profile eeg`). We must treat
Epicurrents as a **vendored, commit-pinned dependency**, not an npm dependency. Budget for that.

---

## 4. Neurosift — the range-streaming pattern to copy (reference only, not adopted)

Neurosift is Apache-2.0 and, usefully, already contains an EDF-over-range reader we can learn from
directly: [`src/shared/EdfViewer/EDFReader.ts`](https://github.com/flatironinstitute/neurosift/blob/main/src/shared/EdfViewer/EDFReader.ts).
Its `RemoteFile` class is the whole pattern in ~120 lines:

- Fixed-size byte chunks, indexed; `#blockCache[chunkIndex]` holds decoded `ArrayBuffer`s.
- `#inProgressChunks[]` deduplicates concurrent requests for the same chunk (callers poll/await
  rather than issuing a second range request).
- **Read-ahead ("smart load")**: a sequential access pattern coalesces `numChunksToLoad`
  contiguous chunks into *one* `Range` request, then splits the response back into per-chunk cache
  entries — amortising round-trip latency during scroll.
- The transport is one primitive: `_readBytes(offset, length)` → `fetch(url, { headers: { Range:
  \`bytes=${offset}-${offset + length - 1}\` } })`.

The same shape recurs in their HDF5/LINDI path
([`ReferenceFileSystemClient.ts#L162`](https://github.com/flatironinstitute/neurosift/blob/main/src/remote-h5-file/lib/lindi/ReferenceFileSystemClient.ts#L162),
[`RemoteH5FileLindi.ts#L580`](https://github.com/flatironinstitute/neurosift/blob/main/src/remote-h5-file/lib/lindi/RemoteH5FileLindi.ts#L580)).

Epicurrents' `_readPartFromFile` is the same idea with different ergonomics (record-aligned chunks
sized by `SETTINGS.app.dataChunkSize`, a block cap from `SETTINGS.app.maxLoadCacheSize`, plus abort
propagation and a per-origin circuit breaker). **If the Epicurrents spike fails, this file is the
blueprint for the custom build** — Apache-2.0, attribution retained.

---

## 5. Integration sketch for the recommended path

### 5.1 Mounting in React 19 / Next 16

The `Epicurrents` class writes `window.__EPICURRENTS__` **in its constructor**
([core/src/index.ts](https://github.com/epicurrents/core/blob/main/src/index.ts), mirrored at
`dist/index.js:45`). It is therefore **not SSR-safe** and must never be imported at module scope in
a component Next may render on the server.

```
app/(lab)/viewer/[recordingId]/page.tsx     server component — auth, then mint a signed URL
  └─ components/lab/EegViewer.tsx           'use client'
       - next/dynamic(..., { ssr: false })  OR  await import() inside useEffect
       - useRef<HTMLDivElement> for the raw canvas host
       - useRef<HTMLCanvasElement> for OUR trend strip (see §6)
```

Renderer mount, inside the effect, after the dynamic import resolves:

```ts
const plot = new WebGlPlot({ /* config incl. getContext attrs */ });
plot.addTo(hostRef.current!);          // creates + appends its own <canvas>
return () => { /* teardown: drop plot, release services */ };
```

`WebGlPlot.addTo()` clears the container's children and sets `position: relative; overflow: hidden`
on it, so give it a dedicated, sized wrapper div — do not hand it a node React also renders into.

### 5.2 Getting bytes

Signed URL minted server-side per recording, handed to the reader as `{ url }`. The reader then
issues its own `Range` requests per chunk; it also supports an `Authorization` header
(`_authHeader`) if we prefer a bearer token over a signed URL. Tune `SETTINGS.app.dataChunkSize`
(bytes per block) and `SETTINGS.app.maxLoadCacheSize` (cache ceiling) — these directly set how much
of the 930 MB is resident.

### 5.3 CSP — what actually has to change

Our current policy (`next.config.ts`, Report-Only unless `CSP_ENFORCE=1`) is:

```
default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com
            https://va.vercel-scripts.com https://auth.presshome.net; img-src 'self' data: blob: ...
```

Precisely, and only:

- **Same-origin workers — no change needed.** There is no `worker-src` and no `child-src`, so
  `worker-src` falls back to `script-src`, which already has `'self'`. The brief is right on this
  point.
- **WASM — no change needed.** `'unsafe-eval'` in `script-src` already permits
  `WebAssembly.compile/instantiate`. (`'wasm-unsafe-eval'` would be the narrower modern option if we
  ever drop `'unsafe-eval'`.) In practice nothing needs it here: **there are no `.wasm` files in the
  1.0.3 tarball at all.** `onnxruntime-web` is a dependency of core and `pyodide` is a separate
  optional service (default `services.pyodide: false`) — neither is on the EDF/trend path.
- **`blob:` workers — this is the one real decision.** Epicurrents' default build inlines its three
  workers via Vite's `?worker&inline` and constructs them from `URL.createObjectURL(blob)`
  (`core/src/util/worker.ts`, `inlineWorker`). `blob:` is **not** in our `script-src`, so under an
  enforcing CSP those workers would be blocked. Upstream documents both sides of this
  (`core/AGENTS.md`, "Worker resolution"): *"a worker is created from a `blob:` URL, which the
  consumer's content security policy must allow. Consumers that cannot grant `worker-src blob:`
  serve the standalone bundles instead and register a URL-based factory, which takes precedence."*
  Those standalone bundles are the `umd/` output, exposed as `"./workers/*": "./umd/*"`.

  **Recommended: take the second option and change nothing in the CSP.** Copy
  `@epicurrents/core/umd/{montage,trend,memory-manager}.worker.js` into `public/epicurrents/` at
  build time and register same-origin URL factories in `RUNTIME.WORKERS` (a
  `Map<name, () => Worker | null>`) *before* constructing the app. Same-origin worker scripts are
  already allowed by `'self'`.

  If we instead accept the inlined default, the single required edit is adding
  `worker-src 'self' blob:` to the `csp` array. Do not rely on `img-src`'s existing `blob:` — it
  does not apply to workers.
- **`connect-src` — no change if bytes come from Supabase Storage**, which
  `https://*.supabase.co` already covers. Any other byte origin (a dedicated object store, a
  signed CDN host) must be added explicitly, or the range requests will be blocked once CSP is
  enforced.
- **Cross-origin isolation — recommend NOT enabling.** SharedArrayBuffer would give the faster
  path (`BiosignalMutex`, `ServiceMemoryManager`), and core checks `window.crossOriginIsolated`
  before using it. Enabling it needs `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` — response headers, *not* CSP — and `require-corp`
  would break every cross-origin subresource that does not send CORP/CORS, which today includes the
  OpenStreetMap tiles and Supabase images already allowed in `img-src`. Core degrades gracefully
  instead: it warns, sets `SETTINGS.app.useMemoryManager = false`, and uses `BiosignalCache`,
  `MontageWorkerSubstitute` and `TrendWorkerSubstitute` (which runs `TrendProcessor` in-process).
  All three substitutes ship in 1.0.3. Take the degraded path; revisit only if profiling demands it.

---

## 6. What we must build ourselves regardless

1. **The qEEG trend strip UI.** Core computes trends but does not draw them. `core/AGENTS.md` is
   explicit: *"Renderer: the consuming interface package adds a draw method and dispatches on
   `trend.derivation.type`."* The only renderers that exist are Vue SFCs in the npm-private
   interface repo (`AeegRenderer.vue`, `SpectrogramRenderer.vue`, `RatioRenderer.vue`,
   `PdbsiRenderer.vue`, `useTrendCanvas.ts`). We write a React canvas renderer against the
   `onEpochReady(signal, epochIndex, totalEpochs)` callback the trend service already emits — which
   is also what gives us progressive fill as epochs compute.
2. **The shared time cursor / linked brush** between the raw pane and the trend strip, plus
   viewport sync. Nothing surveyed provides this across two independently-owned panes.
3. **The event/annotation mark layer**, in our own design tokens. timeline-viewer is CC BY-NC and
   unusable; squiggly's annotation plugin is unlicensed and chart.js-bound.
4. **Server side:** the signed-URL route, and confirming the object store answers `Range` with
   `206` and `Accept-Ranges: bytes`.
5. **Persyst stays export-only.** No `.lay`/`.dat` support exists anywhere in core, edf-reader,
   eeg-module or interface (verified by grep). **EDF+ is the viewer format.**

---

## 7. Risks and unknowns

### Verified risks

- **Bus factor 1.** One person, 20 repos, no co-maintainers. Mitigation: vendor a pinned build via
  the builder manifest, and keep the adapter in §5 thin enough that the renderer is replaceable.
- **No releases, no tags, partial npm publishing.** We cannot `npm install` a working current stack
  (§3). Every upgrade is a deliberate re-pin and re-test.
- **The renderer is mid-migration.** `WebGlPlot`/`CanvasPlot`/`WebGlPlotTrace`/`PlotColor` ship in
  1.0.3's `dist/plots`, but **those files no longer exist under `core/src` on `main`** — they now
  live in `interface/src/components/plots/biosignal/`. Depending on `@epicurrents/core/plots` means
  depending on something upstream is actively moving into a Vue-only, unpublished package. This is
  the strongest single argument for wrapping it behind our own `<RawWaveform>` interface from day
  one, so a swap to a hand-rolled WebGL renderer is a localised change.
- **The documented embedding path is the Vue edition bundle**, not a React-composable library. We
  are going off the documented path. `Epicurrents.launch()` will not run for us.
- **Vite-specific source syntax** (`?worker&inline`) appears in core, montage and memory-manager
  services. It does not reach consumers (it is resolved in *their* build; `'?worker'` appears in 0
  published dist files, verified), but it does mean we cannot build core from source with our own
  bundler without replicating their Vite config.

### Unknowns — not verified, must be settled in the spike

- **Whether core's readers/services can be driven without `Epicurrents.launch()` and a registered
  interface.** This is the load-bearing assumption of the whole recommendation and I did not test
  it. Settle this first.
- **Whether Supabase Storage signed URLs honour `Range` and return `206`.** Not tested. If they do
  not, the byte source has to change and the storage decision reopens.
- **Signed-URL expiry during a long session.** The reader holds `_url` for the life of the
  recording; a 1-hour signed URL will start failing mid-session. I found an `_authHeader` hook but
  **no URL-refresh hook** — unverified whether one exists.
- **Whether `@epicurrents/core@1.0.3`'s dist builds cleanly under Next 16 / Turbopack.** Not
  attempted.
- **Render performance** at 21 ch × 256 Hz alongside the trend strip. Not benchmarked.
- **Clinical fidelity of the trend maths** (aEEG scaling, spectrogram binning, pdBSI pairing)
  against Persyst conventions. Read the code, did not validate the output.
- **The paper's contents.** I verified the citation metadata against PubMed but did not read the
  full text; claims about design intent here come from the code, not the paper.
- **eeg-module on `main` vs published core.** The montage/trend wiring between the two was not
  reconciled; the published eeg-module (0.1.1-8) is definitely too old to use.

---

## 8. Suggested phase-0 spike (time-boxed, ~2 days)

1. Build the EEG edition from `builder` and record the manifest commit pins.
2. Answer the first unknown: instantiate the EDF reader + trend service **without**
   `Epicurrents.launch()`. If that fails, stop and go custom.
3. Serve a conforming PedQuEST EDF+ from the intended object store; confirm `206` + `Accept-Ranges`
   on the wire and that only requested chunks transfer.
4. `WebGlPlot.addTo()` into a React ref; scroll a 24 h file and watch network traffic stay bounded.
5. Register same-origin `umd/` worker factories; flip `CSP_ENFORCE=1` locally and confirm **zero**
   CSP violations with no policy edit.
6. Compute one aEEG trend and draw it with a throwaway canvas renderer driven by `onEpochReady`.
