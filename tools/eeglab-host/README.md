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
scp tools/eeglab-host/eeg-lab-export-worker.service moltbot:/etc/systemd/system/
systemctl daemon-reload && systemctl enable --now eeg-lab-export-worker && journalctl -u eeg-lab-export-worker -n 5
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

To stop the pool: `Stop-ScheduledTask` kills the launcher only — end the six `python.exe` processes
under `C:\pedquest-worker\.venv` too, or they finish their current jobs first (preferable).

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
