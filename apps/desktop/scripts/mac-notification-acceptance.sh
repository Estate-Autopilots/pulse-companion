#!/usr/bin/env bash
# Real hosted macOS UI acceptance. Synthetic notification only, no staff credentials or attendance.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && $(uname -s) == Darwin ]]
[[ -x $PULSE_MAC_APP/Contents/MacOS/pulse-desktop ]]
mkdir -p screens
app_bin="$PULSE_MAC_APP/Contents/MacOS/pulse-desktop"
"$app_bin" --settings=notifications > screens/macos-notifications.log 2>&1 &
pulse_pid=$!
finish() {
  result=$?
  if [[ $result != 0 ]]; then
    screencapture -x screens/macos-notification-failure.png || true
    cat screens/macos-notification-authorization.txt 2>/dev/null || true
    osascript -e 'tell application "System Events" to tell (first process whose bundle identifier is "com.pulse.work") to get entire contents of every window' > screens/macos-notification-ui.txt 2>&1 || true
  fi
  kill "$pulse_pid" 2>/dev/null || true
}
trap finish EXIT
sleep 12
# Exercise the same Turn on control that the person uses. No permission database edits.
cat > "$RUNNER_TEMP/allow-pulse.applescript" <<'SCRIPT'
using terms from application "System Events"
on pressNamed(elements, wanted)
  repeat with elem in elements
    try
      if role of elem is "AXButton" then
        if (name of elem as text) is wanted then
          click elem
          return true
        end if
      end if
      if my pressNamed(UI elements of elem, wanted) then return true
    end try
  end repeat
  return false
end pressNamed
end using terms from

tell application "System Events"
  set pulseProcess to first process whose bundle identifier is "com.pulse.work"
  set frontmost of pulseProcess to true
  if not my pressNamed(UI elements of pulseProcess, "Turn on") then error "Pulse's Turn on button was not accessible"
  repeat 30 times
    delay 1
    -- Enumerating live application-process references races when a short-lived process exits.
    -- Inspect only the actual permission-dialog owners, tolerating a missing process this pass.
    repeat with targetName in {"NotificationCenter", "UserNotificationCenter", "pulse-desktop"}
      try
        set targetProcess to application process (targetName as text)
        if exists targetProcess then
          if my pressNamed(UI elements of targetProcess, "Allow") then return "Allowed through the real notification permission UI"
        end if
      end try
    end repeat
  end repeat
  error "The runner did not expose the Allow notification control"
end tell
SCRIPT
osascript "$RUNNER_TEMP/allow-pulse.applescript" > screens/macos-notification-authorization.txt 2>&1
screencapture -x screens/macos-notification-settings.png
kill "$pulse_pid"; wait "$pulse_pid" 2>/dev/null || true
# The compiled acceptance path is restricted to the public build repository's hosted context.
GITHUB_REPOSITORY=Estate-Autopilots/pulse-companion PULSE_ACCEPTANCE_DIR="$PWD/screens" "$app_bin" --ping-acceptance > screens/macos-ping.log 2>&1 &
pulse_pid=$!
sleep 3
screencapture -x screens/macos-toast.png
wait "$pulse_pid"
python3 - <<'PY'
import json
p=json.load(open('screens/ping.json'))
assert p['shown'] and p['permission'] is None, p
PY
# Verify the actual delivered banner with Apple's native Vision recognizer, as on the iPhone runner.
swiftc apps/mobile/scripts/ios-screen-check.swift -o "$RUNNER_TEMP/mac-ping-check"
"$RUNNER_TEMP/mac-ping-check" screens/macos-toast.png 'New message in a conversation'
