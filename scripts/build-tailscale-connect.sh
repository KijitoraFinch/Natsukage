#!/usr/bin/env bash

set -euo pipefail

UPSTREAM_REPOSITORY="https://github.com/tailscale/tailscale.git"
UPSTREAM_COMMIT="63efd0693318903e13033dda4b503c75ad7aa24e"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_PATH="${ROOT_DIR}/patches/tailscale-connect-ordinary-ssh.patch"
OUTPUT_DIR="${ROOT_DIR}/vendor/tailscale-connect"
FORCE_BUILD=false

if [[ "${1:-}" == "--force" ]]; then
  FORCE_BUILD=true
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--force]" >&2
  exit 2
fi

for command_name in git npm shasum tar; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "required command not found: ${command_name}" >&2
    exit 1
  fi
done

PATCH_SHA256="$(shasum -a 256 "${PATCH_PATH}" | awk '{print $1}')"
SCRIPT_SHA256="$(shasum -a 256 "${BASH_SOURCE[0]}" | awk '{print $1}')"
BUILD_KEY="${UPSTREAM_COMMIT}:${PATCH_SHA256}:${SCRIPT_SHA256}"

if [[ "${FORCE_BUILD}" == false ]] &&
  [[ -f "${OUTPUT_DIR}/.build-key" ]] &&
  [[ -f "${OUTPUT_DIR}/main.wasm" ]] &&
  [[ -f "${OUTPUT_DIR}/pkg.js" ]] &&
  [[ -f "${OUTPUT_DIR}/pkg.css" ]] &&
  [[ "$(<"${OUTPUT_DIR}/.build-key")" == "${BUILD_KEY}" ]]; then
  echo "Tailscale Connect is already built from the pinned source."
  exit 0
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/natsukage-tailscale-connect.XXXXXX")"
SOURCE_DIR="${TEMP_DIR}/tailscale"
PACKAGE_DIR="${TEMP_DIR}/package"

cleanup() {
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

if [[ -n "${NATSUKAGE_TAILSCALE_SOURCE:-}" ]]; then
  echo "Cloning pinned source from ${NATSUKAGE_TAILSCALE_SOURCE}..."
  git clone --quiet --no-checkout --shared \
    "${NATSUKAGE_TAILSCALE_SOURCE}" "${SOURCE_DIR}"
  git -C "${SOURCE_DIR}" remote set-url origin "${UPSTREAM_REPOSITORY}"
  git -C "${SOURCE_DIR}" fetch --quiet --depth 1 origin "${UPSTREAM_COMMIT}"
  git -C "${SOURCE_DIR}" checkout --quiet --detach FETCH_HEAD
else
  echo "Fetching Tailscale ${UPSTREAM_COMMIT}..."
  git init --quiet "${SOURCE_DIR}"
  git -C "${SOURCE_DIR}" remote add origin "${UPSTREAM_REPOSITORY}"
  git -C "${SOURCE_DIR}" fetch --quiet --depth 1 origin "${UPSTREAM_COMMIT}"
  git -C "${SOURCE_DIR}" checkout --quiet --detach FETCH_HEAD
fi

ACTUAL_COMMIT="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
if [[ "${ACTUAL_COMMIT}" != "${UPSTREAM_COMMIT}" ]]; then
  echo "unexpected upstream commit: ${ACTUAL_COMMIT}" >&2
  exit 1
fi

git -C "${SOURCE_DIR}" apply --check "${PATCH_PATH}"
git -C "${SOURCE_DIR}" apply "${PATCH_PATH}"

echo "Building Tailscale Connect from source..."
(
  cd "${SOURCE_DIR}"
  ./tool/go run ./cmd/tsconnect \
    -pkgdir "${PACKAGE_DIR}" \
    build-pkg
)

cp "${SOURCE_DIR}/LICENSE" "${PACKAGE_DIR}/LICENSE"
rm -f "${PACKAGE_DIR}/main.wasm.br" "${PACKAGE_DIR}/main.wasm.gz"
npm pkg set version=1.101.0-natsukage.1 --prefix "${PACKAGE_DIR}"

GO_TOOLCHAIN_COMMIT="$(<"${SOURCE_DIR}/go.toolchain.rev")"
BINARYEN_VERSION="$(<"${SOURCE_DIR}/tool/binaryen.rev")"
WASM_SHA256="$(shasum -a 256 "${PACKAGE_DIR}/main.wasm" | awk '{print $1}')"
JS_SHA256="$(shasum -a 256 "${PACKAGE_DIR}/pkg.js" | awk '{print $1}')"
CSS_SHA256="$(shasum -a 256 "${PACKAGE_DIR}/pkg.css" | awk '{print $1}')"

{
  echo "Tailscale Connect source provenance"
  echo
  echo "upstream_repository=${UPSTREAM_REPOSITORY}"
  echo "upstream_commit=${UPSTREAM_COMMIT}"
  echo "patch=patches/tailscale-connect-ordinary-ssh.patch"
  echo "patch_sha256=${PATCH_SHA256}"
  echo "go_toolchain_commit=${GO_TOOLCHAIN_COMMIT}"
  echo "binaryen_version=${BINARYEN_VERSION}"
  echo "main_wasm_sha256=${WASM_SHA256}"
  echo "pkg_js_sha256=${JS_SHA256}"
  echo "pkg_css_sha256=${CSS_SHA256}"
} >"${PACKAGE_DIR}/SOURCE.txt"

echo "${BUILD_KEY}" >"${PACKAGE_DIR}/.build-key"

rm -rf "${OUTPUT_DIR}"
mkdir -p "$(dirname "${OUTPUT_DIR}")"
mv "${PACKAGE_DIR}" "${OUTPUT_DIR}"

echo "Built ${OUTPUT_DIR}"
echo "main.wasm sha256: ${WASM_SHA256}"
