#!/bin/sh
# Install Intranet Notebook as a systemd service (Linux server, run once with sudo)
# Usage: sudo sh install-service-linux.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
if [ -x "$DIR/runtime/linux-x64/bin/node" ]; then NODE="$DIR/runtime/linux-x64/bin/node"; else NODE="$(command -v node)"; fi
cat > /etc/systemd/system/intranet-notebook.service <<EOF
[Unit]
Description=Intranet Notebook
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$DIR
Environment=PORT=4173
ExecStart=$NODE $DIR/server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now intranet-notebook
echo "Done. Open http://SERVER-IP:4173  (status: systemctl status intranet-notebook)"
