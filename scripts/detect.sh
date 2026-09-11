#!/usr/bin/env bash
# detect.sh — see how the cutter shows up on this Mac.
# Run with the machine plugged in (direct USB port) and powered ON.
# Then copy the whole output into docs/01-machine-profile.md section D.
#
# Safe & read-only: this only *looks*, it never sends anything to the machine.

set -uo pipefail
echo "=================================================================="
echo " Flatbed cutter — Mac detection report"
echo " Tip: run this ONCE with the machine unplugged and ONCE plugged in,"
echo " so we can spot what appeared. (unplugged run = baseline)"
echo "=================================================================="

echo
echo "### 1. Serial ports (this is what we most hope to see) ###"
echo "Look for a NEW /dev/cu.usbserial-* or /dev/cu.usbmodem-* after plugging in."
ls -1 /dev/cu.* 2>/dev/null || echo "  (none found)"

echo
echo "### 2. USB devices (vendor/product IDs identify the chip & machine) ###"
# Compact list: product name + vendor/product id lines only.
system_profiler SPUSBDataType 2>/dev/null \
  | grep -iE "^\s+.*:$|Product ID|Vendor ID|Manufacturer|Serial Number|Speed" \
  || echo "  (system_profiler returned nothing)"

echo
echo "### 3. Known USB-serial driver chips present? ###"
# These are the usual chips behind a 'direct connect' cutter port.
sp=$(system_profiler SPUSBDataType 2>/dev/null)
for chip in "FTDI" "CH340" "CH341" "CP210" "Prolific" "PL2303" "Silicon Labs"; do
  if echo "$sp" | grep -iq "$chip"; then echo "  FOUND: $chip"; fi
done
echo "  (if none listed above, the chip may need a driver before it appears)"

echo
echo "### 4. Loaded serial drivers (kexts) ###"
kextstat 2>/dev/null | grep -iE "usbserial|ftdi|ch34|cp210|prolific|silabs" \
  || echo "  (no third-party serial driver loaded)"

echo
echo "### 5. Network neighbours (for the LAN option) ###"
echo "Your Mac's active IPs:"
ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 || echo "  (none)"
echo "Devices seen on the local network (ARP table):"
arp -a 2>/dev/null | grep -v "incomplete" | head -30 || echo "  (none)"

echo
echo "=================================================================="
echo " Done. Paste everything above into docs/01-machine-profile.md (D)."
echo "=================================================================="
