#!/bin/bash
# Disk space monitor — sends email alert when free space drops below threshold
# Cron: 0 * * * * /var/www/verifa/scripts/disk-monitor.sh
THRESHOLD_GB=10
ALERT_EMAIL="dusan02@gmail.com"
HOSTNAME=$(hostname)

AVAIL_GB=$(df / | awk 'NR==2 {print int($4/1024/1024)}')
USED_PCT=$(df / | awk 'NR==2 {print $5}')

if [ "$AVAIL_GB" -lt "$THRESHOLD_GB" ]; then
  SUBJECT="[ALERT] Disk space low on ${HOSTNAME} — ${AVAIL_GB}GB free"
  BODY="Server: ${HOSTNAME}
Available disk space: ${AVAIL_GB} GB (below ${THRESHOLD_GB} GB threshold)
Used: ${USED_PCT}

Top consumers:
$(du -sh /var/lib/docker/ /var/www/premarketprice/ /var/www/verifa/ /var/log/ /root/.pm2/logs/ 2>/dev/null | sort -rh | head -10)

Docker:
$(docker system df 2>/dev/null)

Action needed:
- docker builder prune -f
- truncate -s 0 /var/www/premarketprice/logs/pm2/*.log
- truncate -s 0 /root/.pm2/logs/*.log
- journalctl --vacuum-size=100M
"
  echo "$BODY" | mail -s "$SUBJECT" "$ALERT_EMAIL"
  echo "Alert sent: $SUBJECT"
fi
