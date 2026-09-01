#!/usr/bin/env bash
# Clean-room install smoke. Packs the current repo, installs the tarball into
# a stock Bun 1.4 container with no host node_modules in scope, and asserts the
# bin runs end-to-end (help text + the parts of `doctor` that don't need Chrome).
#
# Detects fragility before publish: missing files in package.json, ESM ext bugs,
# tsconfig rootDir traps, postinstall scripts that assume the user's shell.
#
# Used by: .github/workflows/ci.yml and scripts/ci-health.ts. Local dev: just run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Pin the multi-platform manifest digest, not only the mutable image tag.
DOCKER_IMAGE="${DOCKER_IMAGE:-oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6}"
WORK_HOST="$(mktemp -d -t designer-smoke-XXXXXX)"
trap 'rm -rf "$WORK_HOST"' EXIT

echo "[smoke] Packing tarball..."
TARBALL="$(bun pm pack --quiet | tail -n1)"
mv "$TARBALL" "$WORK_HOST/$TARBALL"
echo "[smoke] Tarball: $WORK_HOST/$TARBALL"

# Bun executes the packaged TypeScript source directly. Validate the source
# entrypoint is present and the destructive e2e harness is absent before Docker.
#
# We capture tar's output to a file rather than piping into grep -q, because
# `set -o pipefail` + grep -q's early exit causes SIGPIPE on tar, which makes
# the pipeline look like a failure even on a successful match.
TAR_LIST="$WORK_HOST/tar-list.txt"
tar tzf "$WORK_HOST/$TARBALL" > "$TAR_LIST"
if ! grep -q '^package/cli\.ts$' "$TAR_LIST"; then
  echo "[smoke] FAIL: cli.ts missing from tarball." >&2
  echo "[smoke] tarball contents:" >&2
  sed 's/^/  /' "$TAR_LIST" >&2
  exit 1
fi
if grep -q 'e2e-files-delete' "$TAR_LIST"; then
  echo "[smoke] FAIL: destructive e2e harness was included in the tarball." >&2
  exit 1
fi

# We mount only the tarball into the container — no source, no host node_modules.
# That's the whole point of "clean-room": prove the published bytes work alone.
docker run --rm \
  -v "$WORK_HOST:/in:ro" \
  -w /work \
  -e CI=1 \
  "$DOCKER_IMAGE" \
  bash -euo pipefail -c '
    cp /in/'"$TARBALL"' ./pkg.tgz
    bun init -y >/dev/null
    echo "[smoke] Installing tarball..."
    bun add --no-save ./pkg.tgz
    BIN=./node_modules/.bin/designer
    test -x "$BIN" || { echo "[smoke] FAIL: bin not present at $BIN"; exit 1; }
    echo "[smoke] Running designer --help..."
    "$BIN" --help | head -5
    echo "[smoke] Running designer health --help..."
    "$BIN" health --help | head -5
    # Doctor will FAIL in a clean container (no Chrome, no agent-browser, no
    # CDP). We accept that — the goal here is "does the bin run, parse, exit
    # cleanly with code 2", not "does setup pass". A non-2 non-0 exit (e.g.
    # SIGSEGV from a broken native dep, or 127 from a missing shell binary)
    # would indicate real fragility, so we differentiate.
    set +e
    "$BIN" doctor >/tmp/doctor.out 2>&1
    DRC=$?
    set -e
    case "$DRC" in
      0|2) echo "[smoke] doctor exited $DRC (expected 0 or 2)";;
      *)   echo "[smoke] FAIL: doctor exit $DRC (out: $(head -20 /tmp/doctor.out))"; exit 1;;
    esac
    echo "[smoke] OK"
  '

echo "[smoke] PASS"
