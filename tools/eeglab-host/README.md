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
UUID=$(python3 -c "import uuid;print(uuid.uuid4())")
omv-rpc -u admin "ShareMgmt" "set" "{\"uuid\":\"$UUID\",\"name\":\"eeg-lab\",\"reldirpath\":\"storage/eeg-lab/\",\"comment\":\"PedQuEST EEG Teaching Lab recordings\",\"mntentref\":\"96b0df43-864f-4c80-9adf-3d2a6713576d\"}"
SF=$(omv-rpc -u admin "ShareMgmt" "enumerateSharedFolders" | python3 -c "import sys,json;print([s['uuid'] for s in json.load(sys.stdin) if s['name']=='eeg-lab'][0])")
NU=$(python3 -c "import uuid;print(uuid.uuid4())")
omv-rpc -u admin "NFS" "setShare" "{\"uuid\":\"$NU\",\"sharedfolderref\":\"$SF\",\"client\":\"10.100.10.120\",\"options\":\"rw,sync,no_subtree_check,no_root_squash\",\"extraoptions\":\"\",\"comment\":\"moltbot export worker\"}"
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
scp tools/eeglab-host/eeg-lab-export-worker.service moltbot:/etc/systemd/system/
systemctl daemon-reload && systemctl enable --now eeg-lab-export-worker && journalctl -u eeg-lab-export-worker -n 5
```

### 4. NPM proxy host

`eeglab.presshome.net` → `http://10.100.10.102:8335`, certificate 23 (wildcard), **Force SSL on,
HTTP/2 on** (the API defaults both off), Block Common Exploits on. Advanced:

```
proxy_buffering off;
proxy_request_buffering off;
client_max_body_size 0;
proxy_read_timeout 300s;
```

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
