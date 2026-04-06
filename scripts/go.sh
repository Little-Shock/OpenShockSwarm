#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_VERSION="${OPENSHOCK_GO_VERSION:-1.24.0}"
GO_SERIES="${OPENSHOCK_GO_SERIES:-1.24}"
TOOLCHAIN_ROOT="${OPENSHOCK_TOOLCHAIN_ROOT:-$ROOT_DIR/.openshock/toolchains}"

uname_s="$(uname -s | tr '[:upper:]' '[:lower:]')"
uname_m="$(uname -m)"

case "$uname_s" in
  linux|darwin)
    go_os="$uname_s"
    ;;
  *)
    echo "OpenShock Go wrapper does not support OS: $uname_s" >&2
    exit 1
    ;;
esac

case "$uname_m" in
  x86_64|amd64)
    go_arch="amd64"
    ;;
  aarch64|arm64)
    go_arch="arm64"
    ;;
  *)
    echo "OpenShock Go wrapper does not support arch: $uname_m" >&2
    exit 1
    ;;
esac

use_system_go() {
  local candidate version

  if ! candidate="$(command -v go 2>/dev/null)"; then
    return 1
  fi

  version="$("$candidate" version 2>/dev/null || true)"
  if [[ "$version" == *" go${GO_SERIES}"* ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  return 1
}

download_local_go() {
  local archive install_dir lock_dir temp_dir url

  install_dir="$TOOLCHAIN_ROOT/go-$GO_VERSION-$go_os-$go_arch"
  archive="$TOOLCHAIN_ROOT/go-$GO_VERSION-$go_os-$go_arch.tar.gz"
  lock_dir="$TOOLCHAIN_ROOT/go-$GO_VERSION-$go_os-$go_arch.lock"
  temp_dir="$TOOLCHAIN_ROOT/.tmp-go-$GO_VERSION-$go_os-$go_arch-$$"
  url="https://go.dev/dl/go${GO_VERSION}.${go_os}-${go_arch}.tar.gz"

  mkdir -p "$TOOLCHAIN_ROOT"

  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [[ -x "$install_dir/go/bin/go" ]]; then
      printf '%s\n' "$install_dir/go/bin/go"
      return 0
    fi
    sleep 1
  done
  trap "rm -rf '$temp_dir'; rmdir '$lock_dir' 2>/dev/null || true" EXIT

  if [[ -x "$install_dir/go/bin/go" ]]; then
    printf '%s\n' "$install_dir/go/bin/go"
    return 0
  fi

  echo "OpenShock: downloading Go $GO_VERSION for $go_os/$go_arch ..." >&2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$archive"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$archive" "$url"
  else
    echo "Neither curl nor wget is available to download Go." >&2
    exit 1
  fi

  rm -rf "$temp_dir" "$install_dir"
  mkdir -p "$temp_dir"
  tar -C "$temp_dir" -xzf "$archive"
  mv "$temp_dir" "$install_dir"
  trap - EXIT
  rmdir "$lock_dir"
  printf '%s\n' "$install_dir/go/bin/go"
}

if system_go="$(use_system_go)"; then
  exec "$system_go" "$@"
fi

local_go="$TOOLCHAIN_ROOT/go-$GO_VERSION-$go_os-$go_arch/go/bin/go"
if [[ ! -x "$local_go" ]]; then
  local_go="$(download_local_go)"
fi

exec "$local_go" "$@"
