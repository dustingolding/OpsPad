#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Load Rust toolchain from rustup if present.
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

# Use pnpm via npx to avoid requiring a global pnpm install.
npx -y pnpm@9.15.4 install
npx -y pnpm@9.15.4 tauri build "$@"

