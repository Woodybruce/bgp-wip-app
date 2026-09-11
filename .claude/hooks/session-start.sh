#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web — local machines manage their own deps
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# System libraries node-canvas needs to compile (its prebuilt binaries live on
# GitHub releases, which the sandbox egress policy blocks)
if ! dpkg -s libcairo2-dev > /dev/null 2>&1; then
  sudo apt-get update -qq || true
  sudo apt-get install -y -qq build-essential libcairo2-dev libpango1.0-dev \
    libjpeg-dev libgif-dev librsvg2-dev
fi

# Two-phase install: ffmpeg-static's postinstall downloads its binary from
# GitHub releases and fails behind the egress policy, so skip all install
# scripts, then rebuild only the native modules that genuinely need them.
npm install --no-audit --no-fund --ignore-scripts
npm rebuild bcrypt better-sqlite3 canvas sharp esbuild bufferutil

node -e "require('bcrypt'); require('better-sqlite3'); require('canvas'); require('sharp')"
echo "session-start: dependencies ready (note: ffmpeg-static binary unavailable in web sessions)"
