#!/bin/sh
# Daily bandwidth roll-up for eeglab-nginx. Cron on OMV (03:10):
#   10 3 * * * /root/eeglab-nginx/bandwidth.sh
#
# Reads yesterday's lines from the eeglab access log, appends one CSV row per
# day to <recordings>/_meta/bandwidth.csv (visible in the share, so Craig can
# open it), and writes _meta/BANDWIDTH-WARNING.txt when the trailing 30-day
# total crosses WARN_GB. The log is rotated here too (kept 14 days) so the
# container never fills the system disk.
set -eu
LOG=/root/eeglab-nginx/logs/eeglab.access.log
META=/srv/dev-disk-by-uuid-d96070a4-9964-4a49-8d1c-fd443aa03ee3/storage/eeg-lab/_meta
WARN_GB=${WARN_GB:-100}
mkdir -p "$META"
CSV="$META/bandwidth.csv"
[ -f "$CSV" ] || echo "date,requests,bytes,gb,range_requests,unique_clients" > "$CSV"

DAY=$(date -d yesterday +%F)
if [ -f "$LOG" ]; then
  # log_format eeglab: $time_iso8601 $remote_addr "$request" $status $body_bytes_sent "$http_range" ...
  awk -v day="$DAY" '
    substr($1,1,10)==day {
      n++; bytes+=$(NF-3); if ($(NF-2) != "\"-\"") ranges++; ip[$2]=1
    }
    END {
      printf "%s,%d,%d,%.3f,%d,%d\n", day, n, bytes, bytes/1073741824, ranges, length(ip)
    }' "$LOG" >> "$CSV"
  # rotate: keep 14 days of raw log
  cp "$LOG" "$LOG.$DAY" && : > "$LOG"
  docker kill -s USR1 eeglab-nginx >/dev/null 2>&1 || true
  find "$(dirname "$LOG")" -name 'eeglab.access.log.*' -mtime +14 -delete
else
  echo "$DAY,0,0,0.000,0,0" >> "$CSV"
fi

# trailing 30-day total
TOTAL=$(tail -n 30 "$CSV" | awk -F, 'NR>0 && $1 ~ /^[0-9]/ {s+=$4} END {printf "%.1f", s}')
if awk -v t="$TOTAL" -v w="$WARN_GB" 'BEGIN{exit !(t+0 > w+0)}'; then
  printf 'WARNING %s: eeglab served %s GB in the last 30 days (threshold %s GB).\nCheck _meta/bandwidth.csv. Consider a CDN with free egress (Cloudflare R2) before this grows.\n' \
    "$(date +%F)" "$TOTAL" "$WARN_GB" > "$META/BANDWIDTH-WARNING.txt"
else
  rm -f "$META/BANDWIDTH-WARNING.txt"
fi
echo "$DAY rolled up; 30-day total ${TOTAL} GB"
