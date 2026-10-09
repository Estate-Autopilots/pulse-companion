#!/usr/bin/env bash
# The runner action parses its input one line at a time. Keep this setup in one invoked script, not a YAML heredoc.
set -euo pipefail
: "${ANDROID_HOME:?Android SDK required}" "${GITHUB_WORKSPACE:?Runner workspace required}"
mkdir -p "$GITHUB_WORKSPACE/screens"
test ! -e "$ANDROID_HOME/emulator/emulator.bin"
cp "$ANDROID_HOME/emulator/emulator" "$ANDROID_HOME/emulator/emulator.bin"
cat > "$ANDROID_HOME/emulator/emulator" <<'SH'
#!/bin/sh
exec "$ANDROID_HOME/emulator/emulator.bin" "$@" > "$GITHUB_WORKSPACE/screens/emulator-host.log" 2>&1
SH
chmod +x "$ANDROID_HOME/emulator/emulator"
