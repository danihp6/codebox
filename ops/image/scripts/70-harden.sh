#!/usr/bin/env bash

# Hardening that does not depend on the daemon: SSH is key-only, fail2ban watches it,
# unattended-upgrades installs security fixes only, and the sysctl set is the one the security
# document promises. The OCI security list is what limits SSH to the admin /32.

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

log() { printf 'image: %s\n' "$*" >&2; }

log "installing fail2ban and unattended-upgrades"
apt-get update -qq
apt-get install -y -qq --no-install-recommends fail2ban unattended-upgrades

echo "hardening sshd"
cat >/etc/ssh/sshd_config.d/90-codebox.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
X11Forwarding no
AllowAgentForwarding no
EOF
sshd -t

log "configuring fail2ban for sshd"
cat >/etc/fail2ban/jail.d/codebox.conf <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
# The image has no journal for a fresh boot yet, but fail2ban reads the unit file at start.
systemctl enable fail2ban.service

log "limiting unattended-upgrades to security"
cat >/etc/apt/apt.conf.d/51unattended-upgrades-codebox <<'EOF'
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
  >/etc/apt/apt.conf.d/20auto-upgrades
systemctl enable unattended-upgrades.service

log "applying the sysctl baseline"
cat >/etc/sysctl.d/90-codebox.conf <<'EOF'
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_ra = 0
EOF
sysctl --system >/dev/null

apt-get clean
rm -rf /var/lib/apt/lists/*
