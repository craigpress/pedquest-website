# persyst-bridge

The Persyst half of the EEG Teaching Lab pipeline. Polls Supabase for
`eeg_lab_jobs` rows with `stage='persyst'`, and for each one runs PSCLI on a
**scratch copy** of the recording:

```
PSCLI /SourceFile=… /Process        /MMX=<preset>
PSCLI /SourceFile=… /DetectSeizures
PSCLI /SourceFile=… /ExportCSV      /MMX=<preset> /Panel=<panel> /OutputFile=… /ArtifactReduction=Off
```

**That order is not negotiable.** `/DetectSeizures` writes its findings into the
source `.lay`'s `[Comments]`; exporting the CSV first loses them. It also means
the `.lay` is modified in place, so the job always works on a copy.

Outbound-only, like `tools/eeg-render/worker.py`: the licensed Windows box polls
Supabase with the service-role key and opens no inbound port.

Everything here is derived from `docs/PSCLI_PHASE0A_RESULTS.md`, which is the
spec. Pure standard library — no dependencies at all, not even numpy.

## Layout

| Path | What |
|---|---|
| `worker.py` | Poll loop, lease/claim, job orchestration, Supabase REST + storage |
| `persyst_bridge/pscli.py` | PSCLI invocation: exe discovery, licence probe, hard timeouts, the `0xC0000005` retry, source-path guards |
| `persyst_bridge/readback.py` | Trends-CSV all-zero sentinels, `.lay` `[Comments]` detection parser |
| `tests/test_persyst_bridge.py` | Unit tests, inline fixtures, no Persyst required |

## Running

```powershell
cd C:\Users\craig\claude\PedQuest_website\pedquest-site\tools\persyst-bridge
python worker.py --env-file ..\..\.env.local --once      # drain one job and exit
python worker.py --env-file ..\..\.env.local             # poll forever
```

| Flag | Env | Default |
|---|---|---|
| `--pscli` | `PERSYST_PSCLI` | `C:\Program Files (x86)\Persyst\Insight\PSCLI.exe` |
| `--persyst-data-dir` | `PERSYST_DATA_DIR` | `C:\ProgramData\Persyst` |
| `--work-root` | `PERSYST_WORK_ROOT` | `%TEMP%\pedquest-persyst` |
| `--bucket` | `PERSYST_BUCKET` | `eeg-lab` (private) |
| `--default-mmx` | `PERSYST_MMX` | `Trend Settings Version P15.mmx` |
| `--default-panel` | `PERSYST_PANEL` | `VsBaseline Comprehensive` |
| `--lease-seconds` | | 900 |
| `--poll` / `--backoff` | | 15 / 5 s |
| `--worker-id` | | `<hostname>:<pid>` |
| `--keep-scratch` | | off — keeps per-job working directories for diagnosis |

Supabase credentials come from `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`, exactly as `eeg-render` does.

MMX presets are referenced **by name** and resolved against the local install.
They are never copied or vendored — redistribution rights are unestablished. The
worker checks the preset exists, records its SHA-256 in the report, and refuses a
name containing a path separator.

## Retry and lease design

**Retry.** `/Process` faults with `0xC0000005` on roughly one run in three (five
faults in eighteen runs on *unchanged bytes*, measured 2026-09-12). Only that
exit code is retried, up to the row's `max_attempts`, with exponential backoff
from `--backoff`. Each attempt gets a **fresh** `attempt-N/` directory with a new
copy of the recording, because a faulted run leaves partial `<name>.Persyst\`
products behind. Faulted attempt directories are removed unless `--keep-scratch`.

Failure classification, because "retry everything" hides bugs:

| Outcome | Treated as | Row ends up |
|---|---|---|
| `0xC0000005`, budget exhausted | transient | `pending` (another claim) |
| Timeout on any step | transient | `pending` — a modal licence dialog looks exactly like this, and the licence refetches every 48 h |
| Any other non-zero exit | real failure | `error` |
| `/ExportCSV` exits 0 but writes nothing | real failure | `error` |
| Missing preset, missing input artifact, guarded source path | real failure | `error` (does not consume the retry budget) |
| Network / storage / Supabase error | transient | `pending` |

**Lease.** PostgREST has no `SELECT … FOR UPDATE SKIP LOCKED`, so a claim is an
`UPDATE` whose `WHERE` still names the state that was read
(`status=eq.pending`, or `status=eq.running&lease_expires_at=eq.<the exact value
read>`). Postgres re-evaluates that predicate after taking the row lock, so a
worker that loses the race updates zero rows and moves to the next candidate.

The claim sets `status='running'`, `claimed_by`, `lease_expires_at = now + 900 s`
and increments `attempts`. A background thread renews the lease every
`lease/3` seconds; if a renewal updates zero rows the lease has been taken and
the job **stops without writing results** — a duplicated run is better than two
workers writing one row. Rows whose lease has expired are reclaimed on the next
poll rather than sitting in `running` forever, and a row that has burned
`max_attempts` claims is failed rather than reclaimed indefinitely.

Two workers on one licensed box are safe as far as the table is concerned, but
PSCLI's concurrency safety is untested — **run one worker per Persyst machine**.

## Not trusting exit 0

Persyst exits 0 having produced nothing but zeros. Two silent failures are
detected by reading the export back:

* **all-zero VsBaseline** → `report.baseline = "unavailable"`. No baseline window
  exists when the record is shorter than the MMX AutoSearch window (adult
  `StartTime=270` + `Duration=300` s; neonatal 300 + 600 s). When the recording's
  `duration_s` explains it, `report.baseline_reason` says so.
* **all-zero Heart Rate** → `report.heart_rate = "unavailable"`. No channel name
  matched the MMX's `AutoEKGChannels`; a channel literally named `EKG` fixes it.

`Comment` and `Time` are excluded — they are all-zero in a good export as well as
a bad one, so they are never evidence. An export where *every* instrument is zero
raises its own warning.

Detections come from the `.lay` `[Comments]` block
(`time,duration,state,type,text`, text like `@SeizureDetected(P14) p=0.949`) and
land in `report.detections`. `@SeizuresProcessed(P14) v=… alg=5 p=0.10 d=2`
becomes `report.detector`: those applied thresholds are the only record of what
the detector actually did, since PSCLI has no documented flags to pin them.
`/Process` renames every channel to `<name>-Ref` in `[ChannelMap]`; the parser
strips the suffix and sets `report.channels_renamed`.

## Safety guards

Every `/SourceFile` is checked before the process starts: it must be an existing
file, inside the job's own scratch root, not at a drive root, and free of
wildcard characters. **This machine mounts real patient recordings on other
drives.** PSCLI is launched with `shell=False`, so no argument is ever glob-
expanded by a shell either.

Every PSCLI call carries a hard timeout scaled off `duration_s` (`/Process`:
`max(600 s, duration_s)` — about 30× the measured 31×-real-time throughput, loose
on purpose; it exists to break a modal-dialog hang, not to police performance).
On expiry the whole process tree is killed with `taskkill /T /F`.

`PSCLI /Version` runs as a licence-health probe before every claim. If it fails
or times out the worker claims nothing and backs off, so a dead licence cannot
eat the retry budget of every queued job.

## Job contract

Reads `duration_s`, `options`, `artifacts`, `max_attempts`, `attempts`,
`parent_job_id`, `recording_id`, `spec_hash`.

`options`: `mmx` (or `mmx_preset`), `panel`, `artifact_reduction` — all three are
passed to PSCLI on every run. Unspecified flags come from persisted GUI state,
which makes runs irreproducible.

Input: `artifacts.lay` and `artifacts.dat` on this row, or failing that on the
row named by `parent_job_id`. If `artifacts.dat` is absent the `.dat` name is
taken from the `.lay`'s own `File=` key. Paths are bucket-relative (a leading
`eeg-lab/` is tolerated); an absolute URL is fetched as-is.

Writes, merged into `artifacts` rather than replacing it:
`trends_csv`, `processed_lay` (it carries the detections), `montages_xml` when
Persyst produced one — all storage paths in the private `eeg-lab` bucket, to be
served by signed URL. Plus `report` (about 5 KB of JSON for a 30-minute record),
`status`, and `last_exit_code`.

## Windows service registration

**Not registered by this change.** When it is, the shape:

1. **Prove PSCLI works non-interactively first.** The licence is a per-machine
   `P15License_Local.plek` and a past log shows a modal "License Expired" dialog.
   A modal in session 0 is invisible *and* unclosable — the worker's timeout
   turns it into a clean failure rather than a hang, but the box still does no
   work. Until a full chain has been observed under the service account, deploy
   as a **scheduled task with "run only when the user is logged on"** so the
   dialog is at least visible.
2. **Supervisor.** Either Servy (already used on the AI workstation for ComfyUI
   — note its service arguments live in an encrypted DB, not the `.bat`) or a
   scheduled task. The worker is a plain long-running process: no PID file, no
   inbound port; it exits non-zero only on a bad configuration.
3. **One instance per licensed machine** (see above). If a supervisor can
   restart it, make sure it cannot start a second copy.
4. **Console flash.** PSCLI children are already launched with
   `CREATE_NO_WINDOW`. The Python host itself still needs `conhost --headless`,
   `pythonw.exe`, or an S4U principal — `-WindowStyle Hidden` does not suppress
   it. Run `ai-control/scripts/fix-task-windows.ps1` (elevated) after adding the
   task.
5. **Environment.** A service does not inherit the interactive user's shell, so
   pass `--env-file` with an explicit path rather than relying on `SUPABASE_*`
   being set. Add `--log` to get a file instead of a lost stdout.
6. **Scratch.** `--work-root` must be on a drive with room for two copies of the
   longest recording plus its Persyst products, and must not be a network path.

## Tests

```powershell
python -m pytest tests -q
```

28 tests, no Persyst needed: the CSV all-zero sentinels (miniatures of the
measured Phase 0a and 0c exports), the `[Comments]` detection parser, and the
exit-code predicates. The `signed32` test guards a real trap —
`eeg_lab_jobs.last_exit_code` is an `INT`, and an access violation read unsigned
is 3,221,225,477, which overflows `int4` at the exact moment the worker is trying
to record a failure.

## Underspecified in the contract

Resolved by choosing, and worth confirming:

* **`max_attempts` does double duty** — it caps both the in-run `/Process` retry
  budget (the measured intent: 5 attempts leave under 1 % residual) and the
  number of times a row may be claimed. Worst case is 25 `/Process` invocations,
  but that requires five worker crashes.
* **`options` key names.** `mmx` and `mmx_preset` are both accepted; the
  migration comment says only "mmx preset, panel, include_answers".
* **`artifacts` value format.** Assumed bucket-relative storage paths; a
  bucket prefix and an absolute URL are both tolerated.
* **Where the input comes from.** The migration does not say whether the persyst
  row carries its own `artifacts` or inherits them from `parent_job_id`; both
  work.
* **`PSCLI /Version`'s exit-code convention is undocumented.** A version string
  in the output is accepted as healthy even if the exit code is non-zero.
* **A `running` row with a NULL `lease_expires_at` is never reclaimed.** The
  worker never creates one, but a hand-edited row would strand.
* **Detector thresholds cannot be pinned.** `/DetectSeizures` takes no documented
  flag for `alg`/`p`/`d`, so they come from persisted GUI state. The worker
  records what was applied instead of controlling it.
* **`.mmx` AutoSearch values are documented constants, not read from the file.**
  The `.mmx` is a proprietary binary; the adult 270+300 / neonatal 300+600 split
  is keyed off `"neonatal"` appearing in the preset name.
