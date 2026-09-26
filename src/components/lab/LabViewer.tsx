"use client";

// EEG Lab Viewer — the review station.
//
// Opens a recording from disk (EDF+, or Persyst .lay + .dat) or from a finished
// lab job (signed URLs, read a slice at a time), then shows:
//   - a qEEG trend strip over the whole record, computed here progressively
//   - a raw page with montage / filters / sensitivity / timebase
//   - a shared time cursor
//   - annotations: the file's own (bedside), the viewer's (per user), and — for
//     editors — the answer key as an overlay.
//
// State lives here; the panes only paint and raise intents.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { btnGhost, mini } from "@/lib/admin-ui";
import { EdfReader } from "@/lib/eeg/edf";
import { LayReader, mergeLayComments } from "@/lib/eeg/lay";
import { FileByteSource, RangeByteSource } from "@/lib/eeg/sources";
import type { Recording } from "@/lib/eeg/recording";
import { buildMontage, missingElectrodes, MONTAGE_GROUPS, VIEWER_MONTAGES, type ViewerMontageId } from "@/lib/eeg/montage";
import {
  DEFAULT_FILTERS, HIGH_PASS_OPTIONS, LOW_PASS_OPTIONS, NOTCH_OPTIONS, type FilterSettings,
} from "@/lib/eeg/filters";
import { createTrendEngine, defaultHopS, type ViewerTrends } from "@/lib/eeg/trends";
import { loadCachedTrends, saveCachedTrends } from "@/lib/eeg/trend-cache";
import { decodeTrends, TREND_SIDECAR_EXT } from "@/lib/eeg/trend-sidecar";
import { DEFAULT_TARGET, formatClock, type AnnotationTarget, type ViewerAnnotation, type ViewerAnnotationInput } from "@/lib/eeg/annotations";
import { LocalAnnotationStore, RemoteAnnotationStore, type AnnotationStore } from "@/lib/eeg/annotation-store";
import { SYNTHETIC_STAMP, type LabArtifact, type LabJob } from "@/lib/lab/types";
import type { SubmissionState } from "@/lib/courses/types";
import { DEFAULT_PALETTE, PALETTES, loadPalettePreference, savePalettePreference, type PaletteId } from "@/lib/eeg-palette";
import RawPane from "./RawPane";
import TrendStrip, { TREND_PANELS, TREND_WINDOWS, trendRowLabel, trendStripHeight, type TrendRowId } from "./TrendStrip";
import AnnotationPanel, { type Draft } from "./AnnotationPanel";
import { parseAnswerKey, type KeyEvent } from "@/lib/lab/scoring";

export type ViewerSource =
  | { kind: "file"; files: File[] }
  | { kind: "job"; job: LabJob; authHeaders: () => Promise<Record<string, string>>; isInstructor: boolean; canEditKey: boolean };

/**
 * Course context when the recording was opened from an assignment rather than
 * the library: what this learner was asked to do, where they are, and the two
 * writes the header offers. The page owns the state — `my` is re-read after
 * each callback resolves, so the header follows the server, not a guess.
 */
export interface ViewerAssignment {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  instructions: string;
  dueAt: string | null;
  my: SubmissionState;
  canManage: boolean;
  onSubmit: () => Promise<void>;
  onReopen: () => Promise<void>;
}

export interface AnswerSpan { id: string; onsetS: number; offsetS: number; label: string }

const PAGE_OPTIONS = [5, 10, 15, 20, 30, 60];
const SENS_OPTIONS = [2, 3, 5, 7, 10, 15, 20, 30, 50];
const AUX_SENS_OPTIONS = [10, 20, 50, 100, 200, 500, 1000];
const PEN_OPTIONS: { w: number; label: string }[] = [
  { w: 0.5, label: "Hairline" }, { w: 0.75, label: "Thin" }, { w: 1, label: "Normal" }, { w: 1.5, label: "Bold" },
];
const TREND_BLOCK_S = 60;
/** the splitter never lets either pane get smaller than this */
const MIN_PANE_PX = 90;

type ViewMode = "both" | "trends" | "raw";

interface Opened {
  reader: Recording;
  store: AnnotationStore;
  /** identity of the recording bytes for the trend cache; null = do not cache */
  cacheKey: string | null;
  /** fetches the precomputed trends sidecar written beside the recording, when there is one */
  sidecar: (() => Promise<ArrayBuffer>) | null;
  /** for a .lay-backed recording: the parsed .lay, so a per-user copy can be exported */
  lay: LayReader | null;
  /** answer key found among the chosen files or offered by the job */
  answers: AnswerSpan[] | null;
  canFetchAnswers: boolean;
  title: string;
}

function parseAnswerManifest(json: unknown): AnswerSpan[] {
  return parseAnswerKey(json).map(answerSpan);
}

const answerSpan = (event: KeyEvent): AnswerSpan => ({
  id: event.id, onsetS: event.onsetS, offsetS: event.offsetS, label: event.label,
});

function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function LabViewer({ source, onClose, initialT, initialAuthor, assignment }: {
  source: ViewerSource;
  onClose?: () => void;
  /** deep link: seek here once the recording opens (seconds) */
  initialT?: number | null;
  /** deep link: start with this author's marks only (email); teachers arrive here from class results */
  initialAuthor?: string | null;
  /** set when ?course= and ?assignment= named a course assignment */
  assignment?: ViewerAssignment;
}) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  /** disables the turn-in button while its POST is in flight */
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  // "all" | "mine" | author email — filters the list AND what the panes draw
  const [authorFilter, setAuthorFilter] = useState<string>(initialAuthor || "all");
  const appliedInitialT = useRef(false);

  const [pageT0, setPageT0] = useState(0);
  const [pageS, setPageS] = useState(10);
  const [montageId, setMontageId] = useState<ViewerMontageId>("longitudinal_bipolar");
  const [filters, setFilters] = useState<FilterSettings>(DEFAULT_FILTERS);
  const [sensitivity, setSensitivity] = useState(7);
  const [auxSensitivity, setAuxSensitivity] = useState(100);
  const [palette, setPalette] = useState<PaletteId>(DEFAULT_PALETTE);
  const [panelId, setPanelId] = useState(TREND_PANELS[0].id);
  const [windowId, setWindowId] = useState("full");
  const [baselineId, setBaselineId] = useState("first5");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [windowT0, setWindowT0] = useState(0);
  const [cursorT, setCursorT] = useState<number | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);

  const [trends, setTrends] = useState<ViewerTrends | null>(null);
  const [trendVersion, setTrendVersion] = useState(0);
  const [trendProgress, setTrendProgress] = useState(0);
  const [trendsFromCache, setTrendsFromCache] = useState(false);
  const [trendsSource, setTrendsSource] = useState<"sidecar" | "cache" | null>(null);

  // layout: pen width, which panes show, and where the trend/raw splitter sits
  const [penWidth, setPenWidth] = useState(0.75);
  const [view, setView] = useState<ViewMode>("both");
  const [trendH, setTrendH] = useState<number | null>(null);
  const [mainH, setMainH] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<{ y0: number; h0: number } | null>(null);

  const [annotations, setAnnotations] = useState<ViewerAnnotation[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  // where the last click landed, so "A" / "mark at cursor" aims at the same
  // place the eye is on: a trend row, or a raw row's derivation
  const lastPick = useRef<Partial<AnnotationTarget>>({ pane: "raw" });
  const [annBusy, setAnnBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showKey, setShowKey] = useState(false);
  const [answers, setAnswers] = useState<AnswerSpan[] | null>(null);
  const [fileAnnotationCount, setFileAnnotationCount] = useState<number | null>(null);

  // remembered heat-map palette (shared with the image viewer) and viewer theme
  useEffect(() => {
    setPalette(loadPalettePreference());
    try {
      const t = localStorage.getItem("pq-lab-theme"); if (t === "light" || t === "dark") setTheme(t);
      const p = Number(localStorage.getItem("pq-lab-pen")); if (PEN_OPTIONS.some((o) => o.w === p)) setPenWidth(p);
      const v = localStorage.getItem("pq-lab-view"); if (v === "both" || v === "trends" || v === "raw") setView(v);
      const h = Number(localStorage.getItem("pq-lab-trend-h")); if (h > 0) setTrendH(h);
    } catch { /* private mode */ }
  }, []);
  const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    remember("pq-lab-theme", next);
  };
  const choosePalette = (id: PaletteId) => { setPalette(id); savePalettePreference(id); };
  const choosePen = (w: number) => { setPenWidth(w); remember("pq-lab-pen", String(w)); };
  const chooseView = (v: ViewMode) => { setView(v); remember("pq-lab-view", v); };

  // the main column's height drives the trends-only view and the splitter limits
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMainH(Math.floor(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [opened]);

  // ── open ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setOpened(null); setOpenError(null); setTrends(null); setTrendProgress(0); setAnswers(null);
    setAnnotations([]); setPageT0(0); setCursorT(null); setFileAnnotationCount(null);

    async function open(): Promise<Opened> {
      if (source.kind === "file") {
        const byExt = (ext: string) => source.files.find((f) => f.name.toLowerCase().endsWith(ext));
        const edf = byExt(".edf");
        const lay = byExt(".lay");
        const dat = byExt(".dat");
        const key = source.files.find((f) => /\.answers\.json$/i.test(f.name));
        const answers = key ? parseAnswerManifest(JSON.parse(await key.text())) : null;
        const sidecarFile = byExt(TREND_SIDECAR_EXT);
        const sidecar = sidecarFile ? () => sidecarFile.arrayBuffer() : null;
        if (edf) {
          const reader = await EdfReader.open(new FileByteSource(edf));
          const identity = `${edf.name}:${edf.size}:${edf.lastModified}`;
          return {
            reader, lay: null, answers, canFetchAnswers: false, title: edf.name,
            store: new LocalAnnotationStore(identity), cacheKey: `file:${identity}`, sidecar,
          };
        }
        if (lay && dat) {
          const reader = await LayReader.open(await lay.text(), new FileByteSource(dat));
          const identity = `${lay.name}:${dat.size}:${dat.lastModified}`;
          return {
            reader, lay: reader, answers, canFetchAnswers: false, title: lay.name,
            store: new LocalAnnotationStore(identity), cacheKey: `file:${identity}:lay-int-v2`, sidecar,
          };
        }
        if (lay || dat) throw new Error("A Persyst recording needs both the .lay and the .dat file — select them together.");
        throw new Error("Choose an .edf file, or a .lay and .dat pair.");
      }

      const { job, authHeaders, isInstructor } = source;
      const getUrl = async (artifact: LabArtifact) => {
        const res = await fetch(`/api/admin/lab/jobs/${job.id}/download?artifact=${artifact}`, { headers: await authHeaders() });
        const json = await res.json();
        if (!res.ok || !json.url) throw new Error(json.error || `Could not open the ${artifact} artifact.`);
        return json.url as string;
      };
      const store = new RemoteAnnotationStore(job.id, authHeaders, isInstructor);
      const canFetchAnswers = isInstructor && job.options.includeAnswers && Boolean(job.artifacts?.answers);
      const title = job.recordingId ?? job.id;
      // The recording bytes are fixed by (job, spec, renderer); a re-export
      // under a new spec hash or renderer version is a different recording.
      const cacheKey = `job:${job.id}:${job.specHash ?? "-"}:${job.rendererVersion ?? "-"}`;
      // The export worker writes the trends beside the recording; one small
      // signed fetch replaces a walk over the whole file.
      const sidecar = job.artifacts?.trends
        ? async () => {
            const res = await fetch(await getUrl("trends"));
            if (!res.ok) throw new Error(`trends sidecar HTTP ${res.status}`);
            return res.arrayBuffer();
          }
        : null;
      if (job.artifacts?.edf) {
        const reader = await EdfReader.open(await RangeByteSource.open(() => getUrl("edf")));
        return { reader, store, lay: null, answers: null, canFetchAnswers, title, cacheKey: `${cacheKey}:edf`, sidecar };
      }
      if (job.artifacts?.lay && job.artifacts?.dat) {
        const layText = await (await fetch(await getUrl("lay"))).text();
        const reader = await LayReader.open(layText, await RangeByteSource.open(() => getUrl("dat")));
        return { reader, store, lay: reader, answers: null, canFetchAnswers, title, cacheKey: `${cacheKey}:lay-int-v2`, sidecar };
      }
      throw new Error("This job has no viewable recording (needs EDF+ or .lay/.dat).");
    }

    open().then((o) => {
      if (cancelled) return;
      setOpened(o);
      setAnswers(o.answers);
      if (o.reader.labels.length && !buildMontage("longitudinal_bipolar", o.reader.labels).some((d) => d.label.includes("-"))) {
        setMontageId("as_recorded");
      }
    }).catch((e: unknown) => {
      if (!cancelled) setOpenError(e instanceof Error ? e.message : String(e));
    });
    return () => { cancelled = true; };
  }, [source]);

  // ── annotations load ────────────────────────────────────────────────────
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    opened.store.list().then((rows) => { if (!cancelled) setAnnotations(rows); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load annotations."); });
    return () => { cancelled = true; };
  }, [opened]);

  // ── file annotation count (cheap for .lay; a full read for EDF, so only local files) ──
  useEffect(() => {
    if (!opened) return;
    if (!opened.reader.annotationsUpFront && source.kind !== "file") return;
    let cancelled = false;
    opened.reader.scanAnnotations().then((rows) => { if (!cancelled) setFileAnnotationCount(rows.length); }).catch(() => {});
    return () => { cancelled = true; };
  }, [opened, source.kind]);

  // ── trends: sidecar beside the recording → browser cache → compute progressively ──
  useEffect(() => {
    if (!opened) return;
    const { reader, cacheKey, sidecar } = opened;
    if (!reader.sampleRate || !reader.durationS) return;
    let cancelled = false;
    setTrendsFromCache(false);
    setTrendsSource(null);
    (async () => {
      const expectedNT = Math.max(1, Math.floor(reader.durationS / defaultHopS(reader.durationS)));
      const adopt = (t: ViewerTrends, from: "sidecar" | "cache") => {
        setTrends(t);
        setTrendVersion((v) => v + 1);
        setTrendProgress(1);
        setTrendsFromCache(true);
        setTrendsSource(from);
      };
      if (sidecar) {
        try {
          const decoded = decodeTrends(await sidecar(), { durationS: reader.durationS });
          if (cancelled) return;
          if (decoded && decoded.nT === expectedNT) {
            adopt(decoded, "sidecar");
            if (cacheKey) void saveCachedTrends(cacheKey, decoded);
            return;
          }
          console.warn("[viewer] trends sidecar ignored (engine version or shape mismatch); computing");
        } catch (e) {
          if (cancelled) return;
          console.warn("[viewer] trends sidecar unavailable; computing:", e);
        }
      }
      const cached = cacheKey ? await loadCachedTrends(cacheKey) : null;
      if (cancelled) return;
      if (cached && cached.nT === expectedNT) {
        adopt(cached, "cache");
        return;
      }
      const engine = createTrendEngine(reader.durationS, reader.sampleRate, reader.labels);
      setTrends(engine.trends);
      const margin = engine.marginS();
      for (let t0 = 0; t0 < reader.durationS && !cancelled; t0 += TREND_BLOCK_S) {
        const t1 = Math.min(reader.durationS, t0 + TREND_BLOCK_S);
        const win = await reader.readWindow(Math.max(0, t0 - margin), Math.min(reader.durationS, t1 + margin));
        if (cancelled) return;
        engine.process(win.t0, win.data);
        setTrendVersion((v) => v + 1);
        setTrendProgress(t1 / reader.durationS);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled) return;
      setTrendProgress(1);
      if (cacheKey) void saveCachedTrends(cacheKey, engine.trends);
    })().catch((e) => console.error("[viewer] trend computation failed:", e));
    return () => { cancelled = true; };
  }, [opened]);

  // ── derived ─────────────────────────────────────────────────────────────
  const derivations = useMemo(
    () => (opened ? buildMontage(montageId, opened.reader.labels) : []),
    [opened, montageId],
  );
  const durationS = opened?.reader.durationS ?? 0;
  const maxT0 = Math.max(0, durationS - pageS);
  const answerSpans = useMemo(() => (showKey && answers ? answers : []), [showKey, answers]);

  const panelRows = useMemo(() => (TREND_PANELS.find((p) => p.id === panelId) ?? TREND_PANELS[0]).rows, [panelId]);
  const trendRowOptions = useMemo(() => panelRows.map((id: TrendRowId) => ({ id, label: trendRowLabel(id) })), [panelRows]);
  // both vocabularies a learner might name: what the file records and what the montage derives
  const channelOptions = useMemo(() => {
    const out = [...(opened?.reader.labels ?? [])];
    for (const d of derivations) if (!out.includes(d.label)) out.push(d.label);
    return out;
  }, [opened, derivations]);
  const windowS = useMemo(() => {
    const s = TREND_WINDOWS.find((w) => w.id === windowId)?.s ?? null;
    return s && s < durationS ? s : null;
  }, [windowId, durationS]);
  const maxWindowT0 = Math.max(0, durationS - (windowS ?? durationS));

  // Baseline window for the "vs BL" rows. Persyst's default is the opening
  // minutes; "at cursor" lets an instructor re-baseline after an intervention.
  const baseline = useMemo(() => {
    if (!durationS || baselineId === "none") return null;
    const len = baselineId.endsWith("10") ? 600 : 300;
    let start = 0;
    if (baselineId.startsWith("cursor")) {
      if (cursorT === null) return null;
      start = Math.min(Math.max(0, durationS - len), Math.max(0, cursorT));
    }
    return { t0: start, t1: Math.min(durationS, start + len) };
  }, [baselineId, cursorT, durationS]);

  const scrollWindow = useCallback((deltaS: number) => {
    setWindowT0((cur) => Math.min(maxWindowT0, Math.max(0, cur + deltaS)));
  }, [maxWindowT0]);

  const seek = useCallback((t: number) => {
    setCursorT(t);
    setPageT0((cur) => (t >= cur && t < cur + pageS ? cur : Math.min(maxT0, Math.max(0, t - pageS / 2))));
  }, [pageS, maxT0]);

  // deep link (?t=): land on the mark once the recording is open, once only
  useEffect(() => {
    if (!opened || appliedInitialT.current || initialT == null || !Number.isFinite(initialT)) return;
    appliedInitialT.current = true;
    seek(Math.max(0, Math.min(durationS, initialT)));
  }, [opened, initialT, durationS, seek]);

  // what the panes draw follows the panel's author filter (everyone / mine / one learner)
  const visibleAnnotations = useMemo(
    () => annotations.filter((a) => authorFilter === "all" || (authorFilter === "mine" ? a.mine : a.authorEmail === authorFilter)),
    [annotations, authorFilter],
  );

  // keep the trend window around the raw page when paging past its edge
  useEffect(() => {
    if (!windowS) return;
    setWindowT0((cur) => {
      if (pageT0 >= cur && pageT0 + pageS <= cur + windowS) return cur;
      return Math.min(maxWindowT0, Math.max(0, pageT0 - windowS / 2));
    });
  }, [pageT0, pageS, windowS, maxWindowT0]);

  const page = useCallback((deltaS: number) => {
    setPageT0((cur) => Math.min(maxT0, Math.max(0, cur + deltaS)));
  }, [maxT0]);

  // ── trend / raw split ───────────────────────────────────────────────────
  const naturalTrendH = useMemo(() => trendStripHeight(panelRows), [panelRows]);
  const splitterPx = 8;
  const trendPaneH = useMemo(() => {
    if (view === "trends") return Math.max(naturalTrendH, mainH);
    if (view === "raw") return 0;
    const want = trendH ?? naturalTrendH;
    const max = mainH ? Math.max(MIN_PANE_PX, mainH - splitterPx - MIN_PANE_PX) : Infinity;
    return Math.round(Math.min(max, Math.max(MIN_PANE_PX, want)));
  }, [view, trendH, naturalTrendH, mainH]);
  const onSplitDown = (e: React.PointerEvent<HTMLDivElement>) => {
    splitDrag.current = { y0: e.clientY, h0: trendPaneH };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  };
  const onSplitMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = splitDrag.current;
    if (!d) return;
    setTrendH(d.h0 + (e.clientY - d.y0));
  };
  const onSplitUp = () => {
    if (!splitDrag.current) return;
    splitDrag.current = null;
    remember("pq-lab-trend-h", String(trendPaneH));
  };
  const resetSplit = () => { setTrendH(null); try { localStorage.removeItem("pq-lab-trend-h"); } catch { /* ignore */ } };

  const startDraft = useCallback((onsetS: number, durationS: number, target?: Partial<AnnotationTarget>) => {
    setDraft({ ...DEFAULT_TARGET, ...target, id: null, onsetS, durationS, kind: durationS > 0 ? "seizure" : "note", label: "", note: "" });
  }, []);

  // ── keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "ArrowRight": e.preventDefault(); page(e.shiftKey ? 1 : pageS); break;
        case "ArrowLeft": e.preventDefault(); page(e.shiftKey ? -1 : -pageS); break;
        case "PageDown": e.preventDefault(); page(pageS * 5); break;
        case "PageUp": e.preventDefault(); page(-pageS * 5); break;
        case "Home": e.preventDefault(); setPageT0(0); break;
        case "End": e.preventDefault(); setPageT0(maxT0); break;
        case "a": case "A": if (cursorT !== null && !draft) { e.preventDefault(); startDraft(cursorT, 0, lastPick.current); } break;
        case "Escape": setDraft(null); break;
        case "+": case "=": setSensitivity((s) => SENS_OPTIONS[Math.max(0, SENS_OPTIONS.indexOf(s) - 1)] ?? s); break;
        case "-": case "_": setSensitivity((s) => SENS_OPTIONS[Math.min(SENS_OPTIONS.length - 1, SENS_OPTIONS.indexOf(s) + 1)] ?? s); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, pageS, maxT0, cursorT, draft, startDraft]);

  // ── annotation intents ──────────────────────────────────────────────────
  async function saveAnnotation(input: ViewerAnnotationInput, id: string | null) {
    if (!opened) return;
    setAnnBusy(true); setError(null);
    try {
      if (id) {
        const row = await opened.store.update(id, input);
        setAnnotations((rows) => rows.map((r) => (r.id === id ? row : r)));
      } else {
        const row = await opened.store.create(input);
        setAnnotations((rows) => [...rows, row]);
      }
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the annotation.");
    } finally { setAnnBusy(false); }
  }
  async function deleteAnnotation(id: string) {
    if (!opened || !window.confirm("Delete this annotation?")) return;
    setAnnBusy(true); setError(null);
    try {
      await opened.store.remove(id);
      setAnnotations((rows) => rows.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the annotation.");
    } finally { setAnnBusy(false); }
  }
  function exportAnnotations() {
    if (!opened) return;
    const mine = annotations.filter((a) => a.mine);
    const stem = opened.title.replace(/\.(edf|lay|dat)$/i, "");
    if (opened.lay) {
      // A per-user .lay: the original header and [Comments], plus these marks,
      // pointing at the same .dat. Opens in Persyst with the marks on the timeline.
      const text = mergeLayComments(opened.lay.lay, mine.map((a) => ({
        onsetS: a.onsetS, durationS: a.durationS, state: 0, type: 65536,
        text: `${a.label || a.kind}${a.note ? ` — ${a.note}` : ""}`,
      })));
      downloadText(`${stem}.annotated.lay`, text);
    }
    downloadText(`${stem}.annotations.json`, JSON.stringify({ recording: opened.title, annotations: mine }, null, 2), "application/json");
  }

  async function toggleKey() {
    if (showKey) { setShowKey(false); return; }
    if (answers) { setShowKey(true); return; }
    if (source.kind !== "job" || !opened?.canFetchAnswers) return;
    const ok = window.confirm("Show the answer key? This overlays the realized events on the recording. It is the instructor copy.");
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/lab/jobs/${source.job.id}/answer-key`, { headers: await source.authHeaders(), cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !Array.isArray(json.key)) throw new Error(json.error || "Could not fetch the answer key.");
      setAnswers((json.key as KeyEvent[]).map(answerSpan));
      setShowKey(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fetch the answer key.");
    }
  }

  async function promoteAnnotation(mark: ViewerAnnotation) {
    if (source.kind !== "job" || !source.canEditKey) return;
    if (!window.confirm(`Promote your ${mark.kind.replaceAll("_", " ")} mark at ${formatClock(mark.onsetS)} to the answer key?`)) return;
    setAnnBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/lab/jobs/${source.job.id}/answer-key`, {
        method: "POST", headers: await source.authHeaders(), body: JSON.stringify({
          action: "add",
          event: {
            kind: mark.kind,
            onsetS: mark.onsetS,
            offsetS: mark.onsetS + mark.durationS,
            region: mark.region,
            channels: mark.channels,
            label: mark.label || mark.kind.replaceAll("_", " "),
          },
          note: `Promoted from annotation ${mark.id}`,
          expectedGeneration: source.job.answerGeneration,
        }),
      });
      const json = await res.json();
      if (!res.ok || !Array.isArray(json.key)) throw new Error(json.error || "Could not promote the mark.");
      setAnswers((json.key as KeyEvent[]).map(answerSpan));
      setShowKey(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not promote the mark.");
    } finally {
      setAnnBusy(false);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────
  if (openError) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: "var(--accent-secondary)", margin: 0 }}>{openError}</p>
        {onClose && <button type="button" style={{ ...btnGhost, marginTop: 12 }} onClick={onClose}>Back</button>}
      </div>
    );
  }
  if (!opened) {
    return <div style={{ padding: 24, color: "var(--text-muted)" }}>Opening recording…</div>;
  }

  const { reader } = opened;
  const synthetic = source.kind === "job" || /SYNTHETIC/i.test(reader.info.patient) || reader.info.notes.some((n) => /SYNTHETIC|PedQuEST/i.test(n));
  const sel: React.CSSProperties = {
    padding: "5px 8px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)",
    color: "var(--text)", font: "inherit", fontSize: 12.5,
  };
  const lbl: React.CSSProperties = { fontFamily: "var(--mono-font)", fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)" };
  const group = (label: string, node: React.ReactNode) => (
    <label style={{ display: "grid", gap: 3 }}><span style={lbl}>{label}</span>{node}</label>
  );

  // The site is dark-only; the viewer carries its own light palette because
  // EEG is read on white paper. Canvases read these tokens via getComputedStyle.
  const themeVars: React.CSSProperties = theme === "light"
    ? ({
        "--bg": "#f7f8fb", "--bg-card": "#ffffff", "--border": "#cfd6e0", "--border-strong": "#aab4c3",
        "--text": "#101418", "--text-secondary": "#2e3a47", "--text-muted": "#5b6b7c",
        "--accent-primary": "#0f8f82", "--accent-secondary": "#c2410c", "--accent-tertiary": "#15803d",
        "--lab-overlay": "rgba(0,0,0,0.08)",
        color: "#101418",
      } as React.CSSProperties)
    : ({ "--lab-overlay": "rgba(255,255,255,0.10)" } as React.CSSProperties);

  return (
    <div className="lv-root" style={{ ...themeVars, background: theme === "light" ? "var(--bg)" : undefined, borderRadius: 12, padding: theme === "light" ? 8 : 0 }}>
      <style>{`
        .lv-root { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); height: 100%; min-height: 0; gap: 8px; }
        .lv-bar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 0 4px; }
        .lv-bar select { max-width: 100%; }
        .lv-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 10px; min-height: 0; }
        .lv-main { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
        .lv-main-trends, .lv-main-raw { grid-template-rows: minmax(0, 1fr); }
        .lv-trend { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; min-height: 0; }
        .lv-raw { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; min-height: 0; }
        .lv-split { display: flex; align-items: center; justify-content: center; cursor: row-resize; touch-action: none; user-select: none; }
        .lv-split span { width: 48px; height: 3px; border-radius: 2px; background: var(--border); transition: background .15s; }
        .lv-split:hover span, .lv-split:active span { background: var(--accent-primary); }
        .lv-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
        .lv-seg button { border: none !important; border-right: 1px solid var(--border) !important; }
        .lv-seg button:last-child { border-right: none !important; }
        .lv-side { border: 1px solid var(--border); border-radius: 10px; padding: 12px; min-height: 0; background: var(--bg-card); }
        /* Phones and narrow tablets: the fixed-height, two-column workstation
           layout leaves the raw page a few pixels wide.  Stack everything, let
           the page scroll, and give the raw page a viewport-relative height. */
        @media (max-width: 900px) {
          .lv-root { display: flex; flex-direction: column; height: auto; }
          .lv-bar { gap: 8px 10px; }
          .lv-body { grid-template-columns: minmax(0, 1fr); }
          .lv-main { display: flex; flex-direction: column; gap: 6px; }
          .lv-split { display: none; }
          .lv-raw { height: 60vh; min-height: 320px; }
          .lv-side { max-height: 55vh; overflow: auto; }
        }
        @media (hover: none) { .lv-wheel-hint { display: none; } }
      `}</style>
      {/* header */}
      <div className="lv-bar" style={{ alignItems: "center" }}>
        {onClose && <button type="button" style={mini} onClick={onClose} title="Back to where you opened this recording">← Back</button>}
        {assignment && (
          <a href={`/courses/${assignment.courseId}`} style={{ ...mini, textDecoration: "none" }} title={assignment.courseTitle}>
            ← Course
          </a>
        )}
        <div style={{ fontWeight: 600, color: "var(--text)" }}>{opened.title}</div>
        <div style={{ fontFamily: "var(--mono-font)", fontSize: 12, color: "var(--text-muted)" }}>
          {reader.info.format} · {formatClock(durationS)} · {reader.sampleRate} Hz · {reader.labels.length} ch
          {reader.info.startDateTime && ` · ${reader.info.startDateTime.toLocaleString()}`}
          {fileAnnotationCount !== null && ` · ${fileAnnotationCount} file annotation${fileAnnotationCount === 1 ? "" : "s"}`}
        </div>
        {source.kind === "job" && (
          assignment ? (
            <>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }} title={assignment.courseTitle}>
                <b>{assignment.title}</b>
                {assignment.instructions && ` · ${assignment.instructions}`}
                {assignment.dueAt && ` · due ${new Date(assignment.dueAt).toLocaleDateString()}`}
              </span>
              {assignment.canManage ? (
                <a href={`/admin/eeg-lab/library/${source.job.id}/results?course=${assignment.courseId}`} style={{ ...mini, textDecoration: "none" }} title="This course's learners, graded against the answer key">
                  Class results
                </a>
              ) : assignment.my.status === "returned" ? (
                <span style={{ ...mini, cursor: "default" }} title="Your instructor reviewed this one">Returned ✓</span>
              ) : assignment.my.status === "submitted" ? (
                <button
                  type="button" style={mini} disabled={assignmentBusy}
                  title="Turned in — reopen it to keep marking"
                  onClick={() => { setAssignmentBusy(true); void assignment.onReopen().finally(() => setAssignmentBusy(false)); }}
                >
                  Done ✓ · Reopen
                </button>
              ) : (
                <button
                  type="button" style={mini} disabled={assignmentBusy}
                  title="Turn this recording in to your instructor"
                  onClick={() => { setAssignmentBusy(true); void assignment.onSubmit().finally(() => setAssignmentBusy(false)); }}
                >
                  Done with this EEG
                </button>
              )}
            </>
          ) : source.isInstructor ? (
            <a href={`/admin/eeg-lab/library/${source.job.id}/results`} style={{ ...mini, textDecoration: "none" }} title="Every learner's marks graded against the answer key">
              Class results
            </a>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }} title="Your marks are private to you and your instructors">
              <b>Your task:</b> mark every electrographic seizure from onset to offset (drag on the raw EEG or a trend row) and say which channels or region.
            </span>
          )
        )}
        <button type="button" style={{ ...mini, marginLeft: "auto" }} onClick={toggleTheme} title="Toggle light / dark background">
          {theme === "dark" ? "\u2600 light" : "\u263E dark"}
        </button>
        {synthetic && (
          <span style={{ fontFamily: "var(--mono-font)", fontSize: 11, letterSpacing: ".08em", color: "var(--accent-secondary)", border: "1px solid var(--accent-secondary)", borderRadius: 6, padding: "3px 8px" }}>
            {SYNTHETIC_STAMP}
          </span>
        )}
      </div>

      {/* toolbar */}
      <div className="lv-bar">
        {group("Montage", (
          <select style={sel} value={montageId} onChange={(e) => setMontageId(e.target.value as ViewerMontageId)}>
            {MONTAGE_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {VIEWER_MONTAGES.filter((m) => m.group === g).map((m) => {
                  const missing = missingElectrodes(m, reader.labels);
                  const why = missing.length ? `Needs ${missing.join("/")} — not in this recording` : undefined;
                  return (
                    <option key={m.id} value={m.id} disabled={!!why} title={why}>
                      {m.label}{why ? ` — needs ${missing.join("/")}` : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        ))}
        {group("Timebase", (
          <select style={sel} value={pageS} onChange={(e) => setPageS(Number(e.target.value))}>
            {PAGE_OPTIONS.map((p) => <option key={p} value={p}>{p} s/page</option>)}
          </select>
        ))}
        {group("Sensitivity", (
          <select style={sel} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))}>
            {SENS_OPTIONS.map((s) => <option key={s} value={s}>{s} µV/mm</option>)}
          </select>
        ))}
        {group("EKG gain", (
          <select style={sel} value={auxSensitivity} onChange={(e) => setAuxSensitivity(Number(e.target.value))}>
            {AUX_SENS_OPTIONS.map((s) => <option key={s} value={s}>{s} µV/mm</option>)}
          </select>
        ))}
        {group("HP", (
          <select style={sel} value={filters.highPassHz} onChange={(e) => setFilters({ ...filters, highPassHz: Number(e.target.value) })}>
            {HIGH_PASS_OPTIONS.map((f) => <option key={f} value={f}>{f === 0 ? "off" : `${f} Hz`}</option>)}
          </select>
        ))}
        {group("LP", (
          <select style={sel} value={filters.lowPassHz} onChange={(e) => setFilters({ ...filters, lowPassHz: Number(e.target.value) })}>
            {LOW_PASS_OPTIONS.map((f) => <option key={f} value={f}>{f === 0 ? "off" : `${f} Hz`}</option>)}
          </select>
        ))}
        {group("Notch", (
          <select style={sel} value={filters.notchHz} onChange={(e) => setFilters({ ...filters, notchHz: Number(e.target.value) })}>
            {NOTCH_OPTIONS.map((f) => <option key={f} value={f}>{f === 0 ? "off" : `${f} Hz`}</option>)}
          </select>
        ))}
        {group("Pen", (
          <select style={sel} value={penWidth} onChange={(e) => choosePen(Number(e.target.value))} title="Trace line width">
            {PEN_OPTIONS.map((p) => <option key={p.w} value={p.w}>{p.label}</option>)}
          </select>
        ))}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button type="button" style={mini} onClick={() => setPageT0(0)} title="Home">⏮</button>
          <button type="button" style={mini} onClick={() => page(-pageS)} title="Previous page (←)">◀</button>
          <span style={{ fontFamily: "var(--mono-font)", fontSize: 12.5, color: "var(--text)", minWidth: 120, textAlign: "center" }}>
            {formatClock(pageT0)} – {formatClock(Math.min(durationS, pageT0 + pageS))}
          </span>
          <button type="button" style={mini} onClick={() => page(pageS)} title="Next page (→)">▶</button>
          <button type="button" style={mini} onClick={() => setPageT0(maxT0)} title="End">⏭</button>
          {loadingPage && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>loading…</span>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {cursorT !== null && (
            <button type="button" style={mini} onClick={() => startDraft(cursorT, 0, lastPick.current)} disabled={!!draft}>
              + mark at {formatClock(cursorT)}
            </button>
          )}
          {(answers || opened.canFetchAnswers) && (
            <button type="button" style={{ ...mini, borderColor: showKey ? "var(--accent-secondary)" : "var(--border)", color: showKey ? "var(--accent-secondary)" : "var(--text-secondary)" }} onClick={() => void toggleKey()}>
              {showKey ? "Hide key" : "Answer key"}
            </button>
          )}
        </div>
      </div>

      {/* trend toolbar */}
      <div className="lv-bar">
        {group("Trend panel", (
          <select style={sel} value={panelId} onChange={(e) => setPanelId(e.target.value)}>
            {TREND_PANELS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        ))}
        {group("Trend window", (
          <select style={sel} value={windowId} onChange={(e) => { setWindowId(e.target.value); setWindowT0((cur) => Math.min(cur, maxWindowT0)); }}>
            {TREND_WINDOWS.filter((w) => w.s === null || w.s < durationS).map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        ))}
        {windowS && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button type="button" style={mini} onClick={() => setWindowT0(0)} title="Start">⏮</button>
            <button type="button" style={mini} onClick={() => scrollWindow(-windowS)} title="Back one window">◀</button>
            <span style={{ fontFamily: "var(--mono-font)", fontSize: 12.5, color: "var(--text)", minWidth: 130, textAlign: "center" }}>
              {formatClock(windowT0)} – {formatClock(Math.min(durationS, windowT0 + windowS))}
            </span>
            <button type="button" style={mini} onClick={() => scrollWindow(windowS)} title="Forward one window">▶</button>
            <button type="button" style={mini} onClick={() => setWindowT0(maxWindowT0)} title="End">⏭</button>
          </div>
        )}
        <span className="lv-wheel-hint" style={{ ...lbl, alignSelf: "center", textTransform: "none", letterSpacing: 0 }}>
          strip: click seeks · drag scrubs · Shift-drag selects a span to mark{windowS ? " · wheel scrolls" : " · wheel pages"}
        </span>
        {trendsFromCache && trendProgress >= 1 && (
          <span
            style={{ ...lbl, alignSelf: "center" }}
            title={trendsSource === "sidecar"
              ? "Trends came from the precomputed sidecar stored beside the recording"
              : "Trends were restored from this browser's cache instead of recomputed"}
          >
            {trendsSource === "sidecar" ? "precomputed" : "cached"}
          </span>
        )}
        {group("Baseline", (
          <select style={sel} value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
            <option value="first5">First 5 min</option>
            <option value="first10">First 10 min</option>
            <option value="cursor5">5 min from cursor</option>
            <option value="cursor10">10 min from cursor</option>
            <option value="none">None</option>
          </select>
        ))}
        {baseline && (
          <span style={{ fontFamily: "var(--mono-font)", fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>
            BL {formatClock(baseline.t0)} – {formatClock(baseline.t1)}
          </span>
        )}
        {group("Heat map", (
          <select style={sel} value={palette} onChange={(e) => choosePalette(e.target.value as PaletteId)}>
            {PALETTES.map((p) => <option key={p.id} value={p.id} title={p.hint}>{p.label}</option>)}
          </select>
        ))}
        {group("Show", (
          <div className="lv-seg" role="group" aria-label="Which panes to show">
            {([["both", "Both"], ["trends", "Trends"], ["raw", "EEG"]] as [ViewMode, string][]).map(([id, label]) => (
              <button
                key={id} type="button" onClick={() => chooseView(id)} aria-pressed={view === id}
                style={{
                  ...mini, borderRadius: 0,
                  background: view === id ? "var(--bg-card-hover)" : "transparent",
                  color: view === id ? "var(--accent-primary)" : "var(--text-secondary)",
                  fontWeight: view === id ? 700 : 500,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* body */}
      <div className="lv-body">
        <div
          ref={mainRef}
          className={`lv-main lv-main-${view}`}
          style={view === "both" ? { gridTemplateRows: `${trendPaneH}px ${splitterPx}px minmax(0, 1fr)` } : undefined}
        >
          {view !== "raw" && (
            <div className="lv-trend" style={{ overflowY: view === "trends" ? "auto" : "hidden" }}>
              <TrendStrip
                trends={trends} durationS={durationS} cursorT={cursorT} pageT0={pageT0} pageS={pageS}
                annotations={visibleAnnotations} answerSpans={answerSpans} progress={trendProgress} onSeek={seek}
                rows={panelRows} palette={palette} windowT0={windowT0} windowS={windowS} baseline={baseline} theme={theme}
                height={view === "trends" ? Math.max(naturalTrendH, mainH - 2) : trendPaneH - 2}
                onScroll={scrollWindow} onPage={page}
                onSelect={(a, b) => { seek(a); startDraft(a, b - a, { pane: "trend", trendRow: null, viewSpanS: windowS ?? durationS }); }}
                onPick={(t, row) => { lastPick.current = { pane: "trend", trendRow: row, viewSpanS: windowS ?? durationS }; seek(t); }}
                key={trendVersion === 0 ? "empty" : "live"}
              />
            </div>
          )}
          {view === "both" && (
            <div
              className="lv-split"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Drag to resize the trend strip; double-click to reset"
              title="Drag to resize · double-click to reset"
              onPointerDown={onSplitDown}
              onPointerMove={onSplitMove}
              onPointerUp={onSplitUp}
              onPointerCancel={onSplitUp}
              onDoubleClick={resetSplit}
            >
              <span />
            </div>
          )}
          {view !== "trends" && (
            <div className="lv-raw">
              <RawPane
                reader={reader} t0={pageT0} pageS={pageS} derivations={derivations} filters={filters}
                sensitivityUvPerMm={sensitivity} auxSensitivityUvPerMm={auxSensitivity} annotations={visibleAnnotations} answerSpans={answerSpans} cursorT={cursorT} theme={theme}
                penWidth={penWidth}
                onCursor={(t, channel) => { lastPick.current = { pane: "raw", channels: channel ? [channel] : [] }; setCursorT(t); }}
                onSelect={(a, b, channel) => { setCursorT(a); startDraft(a, b - a, { pane: "raw", channels: channel ? [channel] : [] }); }}
                onLoading={setLoadingPage}
                onPage={page}
              />
            </div>
          )}
        </div>
        <div className="lv-side">
          {error && <div style={{ color: "var(--accent-secondary)", fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
          <AnnotationPanel
            annotations={annotations} draft={draft} storeLabel={opened.store.label} busy={annBusy}
            authorFilter={authorFilter} onAuthorFilter={setAuthorFilter}
            trendRows={trendRowOptions} channelOptions={channelOptions}
            onDraftChange={setDraft}
            onSave={(input, id) => void saveAnnotation(input, id)}
            onCancel={() => setDraft(null)}
            onDelete={(id) => void deleteAnnotation(id)}
            onJump={(a) => seek(a.onsetS)}
            onExport={exportAnnotations}
            onPromote={source.kind === "job" && source.canEditKey ? (mark) => void promoteAnnotation(mark) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
