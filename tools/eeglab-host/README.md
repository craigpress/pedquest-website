# eeglab-host — the homelab recording store

Where EEG Teaching Lab recordings live and how they reach the viewer.

```
moltbot (VM 200)                     OMV (VM 102)                          pedquest.org (Vercel)
eeg-lab-export-worker  --NFS-->  storage/eeg-lab/<recording_id>/   <--Range--  viewer (RangeByteSource)
  lab_worker.py                     |  eeglab-nginx :8335 (secure_link)         ^
  eeg-render export                 |  \\10.100.10.102\storage\eeg-lab (SMB)    | expiring URL from
                                    v                                          | /api/admin/lab/jobs/<id>/download
                              NPM eeglab.presshome.net  <-- Cloudflare tunnel --+
```

- **Bytes never touch Supabase.** The exporter runs on the homelab and writes straight to the OMV
  array; Craig opens the same folder over SMB in Persyst or EDFbrowser for manual review.
- **Metadata stays in Supabase** (`eeg_lab_jobs`, `eeg_lab_annotations`, roles). Artifact paths are
  `eeglab://<recording_id>/<file>`; `src/lib/lab/eeglab-store.ts` mints the nginx `secure_link` URL.
- **Bandwidth is measured**, not hoped for: `bandwidth.sh` rolls the access log into
  `eeg-lab/_meta/bandwidth.csv` daily and drops `_meta/BANDWIDTH-WARNING.txt` past 100 GB / 30 days.

## One-time setup (in this order)

Each step is idempotent. All five were run on 2026-09-12 with Craig's approval and verified end to
end (signed 1 MiB Range read through NPM = 206 with matching bytes; expired = 410; tampered = 403;
`/healthz` = 200 from the Cloudflare edge). Kept here so the store can be rebuilt.

### 1. OMV — shared folder + NFS export (`ssh omv`)

```sh
BASE=/srv/dev-disk-by-uuid-d96070a4-9964-4a49-8d1c-fd443aa03ee3
mkdir -p "$BASE/storage/eeg-lab" && chown root:users "$BASE/storage/eeg-lab" && chmod 2775 "$BASE/storage/eeg-lab"
NEW=$(sed -n 's/^OMV_CONFIGOBJECT_NEW_UUID="\(.*\)"//p' /etc/default/openmediavault)   # new-object placeholder
omv-rpc -u admin "ShareMgmt" "set" "{\"uuid\":\"$NEW\",\"name\":\"eeg-lab\",\"reldirpath\":\"storage/eeg-lab/\",\"comment\":\"PedQuEST EEG Teaching Lab recordings\",\"mntentref\":\"96b0df43-864f-4c80-9adf-3d2a6713576d\"}"
SF=$(omv-rpc -u admin "ShareMgmt" "enumerateSharedFolders" | python3 -c "import sys,json;print([s['uuid'] for s in json.load(sys.stdin) if s['name']=='eeg-lab'][0])")
# mntentref is required (same placeholder); extraoptions must be non-empty
omv-rpc -u admin "NFS" "setShare" "{\"uuid\":\"$NEW\",\"sharedfolderref\":\"$SF\",\"mntentref\":\"$NEW\",\"client\":\"10.100.10.120\",\"options\":\"rw,sync,no_subtree_check,no_root_squash\",\"extraoptions\":\"secure\",\"comment\":\"moltbot export worker\"}"
omv-salt deploy run fstab nfs
grep eeg-lab /etc/exports && ls -la /export/eeg-lab     # verify the bind mount shows the real folder
```

`storage` is already an SMB share, so `\\10.100.10.102\storage\eeg-lab` needs nothing more.

Files written over NFS inherit `storage`'s default ACL (`group::---`, `other::---`), which the nginx
worker (uid 101, in group `users` via the compose command) cannot read. Grant the group once, with a
default entry so new recordings inherit it:

```sh
setfacl -R -m g:users:rwX -m d:g:users:rwX "$BASE/storage/eeg-lab"
```

Symptom if skipped: signed URLs return 403 while `$secure_link` is 1 - the signature is fine, the
`open()` is what fails. (Applied 2026-09-12.)

### 2. OMV — nginx origin (`ssh omv`)

```sh
mkdir -p /root/eeglab-nginx/logs /etc/eeglab
[ -s /etc/eeglab/secret ] || (umask 077; head -c 32 /dev/urandom | base64 | tr -d '=+/' > /etc/eeglab/secret)
# copy compose.yml, nginx.conf, bandwidth.sh from this directory into /root/eeglab-nginx/
cd /root/eeglab-nginx && chmod +x bandwidth.sh && docker compose up -d
curl -s localhost:8335/healthz          # ok
curl -sI localhost:8335/anything        # 403 (unsigned)
( crontab -l 2>/dev/null; echo "10 3 * * * /root/eeglab-nginx/bandwidth.sh >> /root/eeglab-nginx/logs/bandwidth.log 2>&1" ) | crontab -
```

Then put the same secret in the encrypted store as `EEG_LAB_URL_SECRET` (`Set-HomelabSecret`) and
in Vercel (Production + Preview) together with `EEG_LAB_BASE_URL=https://eeglab.presshome.net`.
For local dev add both to `pedquest-site/.env.local`.

### 3. moltbot — mount + worker (`ssh moltbot`)

```sh
mkdir -p /mnt/eeg-lab
grep -q eeg-lab /etc/fstab || echo "10.100.10.102:/export/eeg-lab  /mnt/eeg-lab  nfs  rw,sync,noatime,rsize=262144,wsize=262144,_netdev,nofail  0  0" >> /etc/fstab
systemctl daemon-reload && mount /mnt/eeg-lab && touch /mnt/eeg-lab/.write-test && rm /mnt/eeg-lab/.write-test
# renderer >= 0.3.8 is already installed in /opt/pedquest-eeg-render/.venv (deployed 2026-09-12 from git HEAD)
scp tools/eeg-render/lab_worker.py moltbot:/opt/pedquest-eeg-render/lab_worker.py
# the viewer's trend engine, bundled for Node (moltbot has node 24 for OpenClaw); the worker
# runs it after every export to write <recording>.trends.bin beside the recording
npm run trends:sidecar:build && scp tools/trend-sidecar/dist/trend-sidecar.mjs moltbot:/opt/pedquest-eeg-render/
scp tools/eeglab-host/eeg-lab-export-worker@.service moltbot:/etc/systemd/system/
systemctl daemon-reload && systemctl enable --now eeg-lab-export-worker@1 eeg-lab-export-worker@2
journalctl -u "eeg-lab-export-worker@*" -n 5
```

Two instances (2026-09-13; the box has 4 vCPU, an export needs ~400 MB and one core). The template
sets `EEG_LAB_CLAIM_MIN_AGE_S=120`: **moltbot is the fallback host** — it only claims pending jobs
that have waited two minutes, so a job requested on the website goes to the CraigsRig pool (below)
whenever the desktop is up, and to moltbot otherwise. Expired leases are always fair game for either.
The old single-instance `eeg-lab-export-worker.service` is retired.

```sh
```

### 4. NPM proxy host

`eeglab.presshome.net` → `http://10.100.10.102:8335`, certificate 23 (wildcard), **Force SSL on,
HTTP/2 on** (the API defaults both off), Block Common Exploits on. Created as **host 87**. Advanced:

```
client_max_body_size 0;
```

Do not add `proxy_buffering`/`proxy_read_timeout` here: NPM already sets them globally in
`/data/nginx/custom/server_proxy.conf`, and the duplicate is an `[emerg]` that leaves
`proxy_host/87.conf` unwritten (host shows online in the UI, 502/handshake failures in practice).

Technitium already answers `eeglab.presshome.net → 10.100.10.105` (wildcard), so LAN works as soon
as the host exists.

### 5. Cloudflare (off-LAN, for pedquest.org viewers)

Proxied `CNAME eeglab → f861b2ea-11d2-48fc-b745-943332b53db0.cfargotunnel.com`, and a tunnel
ingress entry **before** the 404 catch-all:

```json
{"hostname": "eeglab.presshome.net", "service": "https://10.100.10.105",
 "originRequest": {"noTLSVerify": true, "matchSNItoHost": true, "originServerName": "eeglab.presshome.net",
                   "http2Origin": true, "disableChunkedEncoding": true}}
```

Verify from outside the LAN: `curl -sI --resolve eeglab.presshome.net:443:104.21.54.133 https://eeglab.presshome.net/healthz`
should return `Server: openresty` and `ok`.

## CraigsRig worker pool (added 2026-09-13)

moltbot exports at ~8–9 min per recorded hour on one i5-8500T core. The desktop (Core Ultra 9
285K, 24 cores) runs **six** `lab_worker.py` copies against the same queue — the claim is a
conditional UPDATE, so mixed hosts never take the same job. Files: `C:\pedquest-worker\`
(`run-pool.ps1` launcher, `register-task.ps1`, `.venv` with `pip install -e tools/eeg-render`,
`work\`, `logs\worker-N-<stamp>.err.log`). Scheduled task **"PedQuEST EEG lab worker pool"**
(SYSTEM, at startup + 2 min, no time limit; start by hand with `Start-ScheduledTask`). Credentials
come from the repo's `.env.local`; the sidecar tool is the repo's `tools/trend-sidecar/dist/`.

Store access is the **Windows NFS client** (`ServicesForNFS-ClientOnly` + `ClientForNFS-Infrastructure`)
at the UNC path `\\10.100.10.102\export\eeg-lab`, with a second OMV export for client `10.100.10.20`:
`rw,sync,no_subtree_check,all_squash,anonuid=0,anongid=100` + `insecure` (Windows uses high source
ports). Files land as `root:users` like moltbot's. Two landmines:

- SMB is the wrong transport for a service here (no per-user credentials from SYSTEM/SSH —
  memory `error_localsystem_smb_three_layers`).
- The Windows NFS client **evaluates mode bits as "other"** and ignores the `AnonymousUid`
  registry mapping: it can create and write files but cannot read back anything that is not
  world-readable, and `copystat` on the destination fails. The worker therefore never reads from
  the store (sidecar computed from the local export; `_copy_to_store` ignores copystat errors).

Each export uses `EEG_RENDER_JOBS` cores (`eeg-render export --jobs`, `export/parallel.py`; output is
bit-identical at any job count): the pool sets 2 (6 × 2 = 12 of 24 cores), moltbot's template 2. Measured
on the desktop for one recorded hour: ~53 s single-core, ~18 s at 4 cores (after the ECG slice fix and the
single-pass tee; it was ~4 min when the pool started).

To stop or restart the pool: `C:\pedquest-worker\restart-pool.ps1 stop|start|status` (elevated) —
`stop` ends the launcher, the six workers and their eeg-render children; then release their rows
(`update eeg_lab_jobs set status='pending', claimed_by=null, lease_expires_at=null where status='running'
and claimed_by like 'craigsrig%'`) so the restarted pool reclaims them at once instead of after the lease.

`status` is also the check to run before assuming the queue is being served: a `stop` leaves the task
`Ready` with `LastTaskResult` **267014** (`SCHED_S_TASK_TERMINATED`) and zero processes, and a requeued
job then sits `pending` indefinitely with nothing to claim it (seen 2026-09-13). Run it through
`ssh ai-workstation` for an un-UAC-filtered token — unelevated, `Get-ScheduledTask` cannot see the SYSTEM
task and the process list reads as 0 even when the pool is running.

**A job can fail five times over one earlier success.** If the export finishes but the `done` PATCH fails
(Supabase 504), the attempt leaves a complete root-owned folder in the store; the Windows NFS client cannot
overwrite or delete it, so every retry dies with `PermissionError` on the `.LAY` until the attempts run out.
`lab_worker.py` from `c90c383` clears such a folder where it can and otherwise writes `<recording_id>-a<attempt>`.
For older folders: move the directory aside on OMV (`mv … _stale-<id>-<why>`), reset the row
(`status='pending', attempts=0, error=null, claimed_by=null, lease_expires_at=null`), and delete the stale
copy once the rerun's folder is complete.

## Trends sidecar (`<recording>.trends.bin`)

Every export gets the viewer's qEEG trends precomputed beside it by `tools/trend-sidecar` — the same
TypeScript engine the browser runs, so the strip is identical either way; the viewer tries the
sidecar, then its IndexedDB cache, then computes. When `TREND_ENGINE_VERSION` (`src/lib/eeg/trends.ts`)
is bumped, old sidecars are ignored (the viewer computes) until they are rewritten:

```sh
# on moltbot, with the worker's env for --update-db
cd /opt/pedquest-eeg-render && set -a && . /root/.openclaw/workspace/config/case-image-worker.env && set +a
node trend-sidecar.mjs --backfill /mnt/eeg-lab --update-db          # missing or stale only
node trend-sidecar.mjs --backfill /mnt/eeg-lab --update-db --force  # rewrite all
```

Roughly 10–25 s per recording on moltbot; 2–5 MB per sidecar.

### Generator rollout (2026-09-18)

Both worker fleets now run `eeg-render` 0.4.0 and trend engine 3. Rebuild the
sidecar bundle with `npm run trends:sidecar:build` whenever the viewer's trend
engine changes, then deploy `tools/trend-sidecar/dist/trend-sidecar.mjs` to
`/opt/pedquest-eeg-render/trend-sidecar.mjs` on moltbot. The Windows pool uses
the local bundle directly. Backfill stored sidecars after a version bump;
updating only the generator does not repair existing recordings.

The 52 bank image specs remain pinned to `spec_version: 1`; their metadata
matches 0.4.0 and three representative re-renders were byte-identical. Refresh
database metadata with `RENDERER_VERSION=0.4.0` and `qbank-refresh-sidecars.mts`,
not `qbank:import`, to preserve review status. Unused example images are excluded
from that script's version check. New term/unspecified-PMA neonatal lab exports
retain the existing 19-electrode policy; explicitly preterm (<37 weeks PMA)
recordings can retain reduced acquisition. Trend regeneration does not change
raw recording channels.

### Generator rollout 0.4.1 (2026-09-20)

Renderer 0.4.1 (negative-up pages, burst-aware display calibration, authored `ibi_range_s`, no fragment
rhythmic-pattern runs, reduced-array graphoelement fields, steep short blinks, no muscle floor when unreactive,
Castro Conde 2017 term anchors) deployed to moltbot by tar-over-ssh into the editable install
(`/opt/pedquest-eeg-render`, `pip install --no-deps -e .`), all three units restarted and active. Rollback copy:
`/opt/pedquest-renderer-pre041-20260920.tar.gz` (excludes `.venv`). The CraigsRig pool's venv is editable against
`pedquest-site/tools/eeg-render`, so it follows main; re-run `pip install --no-deps -e` there after the merge so the
package metadata reports 0.4.1, then `restart-pool.ps1 stop|start`.

**The 52 bank specs are no longer pinned.** `spec_version: 1` was removed from every question YAML on 2026-09-20 after
Craig accepted the P5 gallery (31 accept, 1 revise, 1 unscored), and all 52 images were re-rendered at version 2:
every page now draws negative-up with the version-2 defaults. Refresh database metadata with
`RENDERER_VERSION=0.4.1 npx tsx scripts/qbank-refresh-sidecars.mts --apply`, not `qbank:import`.

Rollback copies on moltbot: `/opt/pedquest-renderer-pre040-20260918.tar.gz`,
`/opt/pedquest-eeg-render/trend-sidecar.v2-20260918.mjs`, and
`/opt/pedquest-eeg-render/trends-v2-20260918.tar.gz`. The old trend files require
the matching viewer engine; engine 3 intentionally rejects them.

### Generator rollout 0.4.4 (2026-09-21) - PQ-G-002 review fixes

Craig's read of PQ-G-002 in the viewer: mirrored posterior temporal and vertex chains, an alpha-delta asymmetry
that "recovered" at 5-6 h, too much muscle for a sedated child. 0.4.4 changes the version-2 defaults, so EVERY
bank image was re-rendered (`render-all --force`, sidecars regenerated and verified): the per-electrode scalp gain
is smoothed over the head (monopole field, falloff 0.6) and the default `channel_gain_max` is 1.5 (was 2.0 - the
PQ-G-002 seed had T5/T6/Cz at 2.0 against 0.7-0.85 neighbours, r = -0.84 between the two derivations around T5);
`seizure_cluster` runs follow the single-seizure muscle rule (no spread = no muscle). The PQ-G-002 spec itself was
repaired in the database (first right attenuation runs to the end of the record) and re-queued for both the image
(`eeg_case_render_jobs`) and the Lab export (`eeg_lab_jobs`, a clone of the prior job with the spec wrapped as an
image block - a bare spec errors with "job spec is not an image block"). The re-render exposed two extra pollers of
`eeg_case_render_jobs`: a legacy `case-image-worker.service` on moltbot (OpenClaw workspace script at renderer 0.3.11,
now disabled) and the CraigsRig scheduled task "PedQuest qbank render worker" (system Python running the repo's
`worker.py`, which imports the package once at start - restart it after every deploy, over ssh: the local
unelevated shell cannot see the task). Rollout as before; rollback copy
`/opt/pedquest-renderer-pre044-20260921.tar.gz`. The other 57 Lab recordings still carry their earlier renderer
versions (PQ-G-002's was 0.3.9); re-exporting them is a separate decision (12-24 h files).

### Generator rollouts 0.4.2 and 0.4.3 (2026-09-20)

0.4.2 (P7 batches 1-2: neonatal state cycle, hours of life, transient sharps, dysmaturity; keyed reactivity, CAPE,
breach, AP gradient) went to moltbot and the CraigsRig pool the same way as 0.4.1 (rollback
`/opt/pedquest-renderer-pre042-20260920.tar.gz`), DB metadata refreshed at 0.4.2.

0.4.3 = P7 batches 4 and 5, all opt-in, no signal change for the 52 bank specs (sidecars restamped, 52/52 verified,
bank sidecars carry no manifest so nothing was re-rendered): `clinical_correlate` on ictal events and
`summary.seizure_burden` in every Lab manifest (ESE / nonconvulsive / neonatal-status flags), a `sporadic_discharges`
event keyed one by one with the ACNS prevalence category (`summary.sporadic_discharges`), and `background.variants`
(hypnagogic hypersynchrony, POSTS, posterior slow waves of youth, each keyed as `normal_variant`). Rollout: tar-over-ssh
into the editable install on moltbot, the three units restarted; CraigsRig pool `pip install --no-deps -e` +
`restart-pool.ps1 stop|start`; `RENDERER_VERSION=0.4.3 npx tsx scripts/qbank-refresh-sidecars.mts --apply`. Rollback
copy `/opt/pedquest-renderer-pre043-20260920.tar.gz`.

## After a host reboot (OMV or moltbot)

Seen 2026-09-13 when the Proxmox host restarted both VMs:

- `eeglab-nginx` did **not** come back under `restart: unless-stopped` (the nexus containers with the
  same policy did) → every signed URL was a 502 from NPM. Check `docker ps -a --filter name=eeglab`
  on omv; `cd /root/eeglab-nginx && docker compose up -d`. The policy is now `restart: always`.
- The moltbot NFS mount renegotiates `rsize/wsize` on remount (262144 in fstab → 131072 observed);
  harmless when moltbot reboots after OMV, dangerous the other way round (memory
  `error_nfs_oversized_rpc_fragment`).
- A bank export that is "claimed" again at the same minute every hour and ends in
  `exhausted 5 of 5 attempts` is the worker's subprocess timeout (`EEG_LAB_EXPORT_TIMEOUT_S`,
  default 3600 s) killing a 12–24 h recording, not a Supabase or lease fault. The unit sets 21600 s.
  Requeue: `update eeg_lab_jobs set status='pending', attempts=0, error=null, lease_expires_at=null,
  claimed_by=null where recording_id='LAB-…' and status='error';` via `npx supabase db query --linked -f`.

## Verifying end to end

1. Queue an export from `/admin/eeg-lab` (10 min is enough). The job should go `pending → running → done`
   within a minute and `artifacts` should read `eeglab://LAB-…/LAB-….edf`.
2. `ls /mnt/eeg-lab/LAB-*/` on moltbot and open the same folder over SMB.
3. "Open in viewer" — the browser should issue ~1 MiB `206` responses against `eeglab.presshome.net`
   (network tab), never a whole-file transfer, and keep paging past the 2-minute URL expiry.
4. Next morning: `eeg-lab/_meta/bandwidth.csv` has a row.

## Not done / follow-ups

- `tools/persyst-bridge/worker.py` still downloads its input `.lay/.dat` from the Supabase bucket. When
  PSCLI processing is un-parked, point it at the SMB share (`\\10.100.10.102\storage\eeg-lab\<id>\`)
  — the paths are already `eeglab://…`.
- Retention: `eeg_lab_jobs.expires_at` is set but nothing deletes folders yet. A reaper belongs on
  moltbot next to the worker.
- Feed `_meta/bandwidth.csv` into Nexus so the warning is a dashboard finding, not a file.
