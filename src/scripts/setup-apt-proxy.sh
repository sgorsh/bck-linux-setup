#!/bin/bash
# APT Proxy Setup Script for Beckhoff RT Linux Devices
# This script temporarily configures APT to use an HTTP proxy with automatic cleanup

set -e

# Restores original APT configuration
restore_config() {
  echo ""
  echo "→ Restoring default APT configuration..."
  sudo mv /etc/apt/sources.list.bak /etc/apt/sources.list 2>/dev/null || true
  sudo mv /etc/apt/sources.list.d/bhf.list.bak /etc/apt/sources.list.d/bhf.list 2>/dev/null || true
  sudo mv /etc/apt/auth.conf.d/bhf.conf.bak /etc/apt/auth.conf.d/bhf.conf 2>/dev/null || true
  sudo rm -f /etc/apt/apt.conf.d/99proxy
  echo "→ Restore complete"
}

# Needed for restore permissions
echo "→ Caching sudo credentials..."
sudo -v

# Register restore_config trap for EXIT, INT, TERM, and HUP (SSH disconnect) signals
# Separate handlers ensure interruptions exit with proper signal codes (130 for INT, 143 for TERM/HUP)
trap 'restore_config; exit 130' INT TERM HUP
trap 'restore_config' EXIT

echo "→ Backing up APT sources and auth..."
if [ -f /etc/apt/sources.list.bak ] || [ -f /etc/apt/sources.list.d/bhf.list.bak ] || [ -f /etc/apt/auth.conf.d/bhf.conf.bak ]; then
  echo "Warning: Backup files already exist. Restore may not have completed from a previous run."
  restore_config
fi
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak

if [ -f /etc/apt/sources.list.d/bhf.list ]; then
  sudo cp /etc/apt/sources.list.d/bhf.list /etc/apt/sources.list.d/bhf.list.bak
fi

if [ -f /etc/apt/auth.conf.d/bhf.conf ]; then
  sudo mv /etc/apt/auth.conf.d/bhf.conf /etc/apt/auth.conf.d/bhf.conf.bak
fi

echo "→ Converting HTTPS to HTTP in APT sources..."
sudo sed -i 's|https://|http://|g' /etc/apt/sources.list

if [ -f /etc/apt/sources.list.d/bhf.list ]; then
  sudo sed -i 's|https://|http://|g' /etc/apt/sources.list.d/bhf.list
fi

echo "→ Configuring APT proxy (127.0.0.1:3142)..."
echo 'Acquire::http::Proxy "http://127.0.0.1:3142";' | sudo tee /etc/apt/apt.conf.d/99proxy >/dev/null
echo ""