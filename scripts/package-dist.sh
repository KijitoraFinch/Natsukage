#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
SOURCE_DIR="${DIST_DIR}/source"

mkdir -p "${SOURCE_DIR}"
cp "${ROOT_DIR}/LICENSE" "${DIST_DIR}/LICENSE"
cp "${ROOT_DIR}/SECURITY.md" "${DIST_DIR}/SECURITY.md"
cp "${ROOT_DIR}/THIRD_PARTY_NOTICES.md" "${DIST_DIR}/THIRD_PARTY_NOTICES.md"
cp \
  "${ROOT_DIR}/patches/tailscale-connect-ordinary-ssh.patch" \
  "${SOURCE_DIR}/tailscale-connect-ordinary-ssh.patch"
cp \
  "${ROOT_DIR}/vendor/tailscale-connect/SOURCE.txt" \
  "${SOURCE_DIR}/TAILSCALE_CONNECT_SOURCE.txt"
