# Pulse Companion — client apps for Pulse by Estate Autopilots

Desktop tray/menu-bar panel, iPhone and Android apps, and Chrome extension for https://pulse.estateautopilots.com.
Approve an app’s pairing code in your Pulse browser. Attendance follows My desk; device access is revocable in Settings → Devices.

Client source only, with fresh history. No Pulse server, employee records, research, credentials or signing keys.
GitHub Actions produces Windows MSI/EXE, universal macOS DMG, Android APK, unsigned iOS Simulator and device archives, and a Chrome ZIP.
These are unsigned test builds. Apple and Windows distribution signing will be configured separately.

Build: Node from `.nvmrc`, `corepack enable`, `pnpm install --frozen-lockfile`.
Desktop: `pnpm --dir apps/desktop run build`, then `pnpm --dir apps/desktop exec tauri build` on Windows or macOS.
Phone: `pnpm --dir apps/mobile exec expo prebuild --clean`, then Gradle or Xcode as in the workflow.
Chrome: `node apps/chrome-extension/scripts/package.mjs pulse-chrome.zip`.
Worker cap: two. Workspace checks run sequentially.

All rights reserved. See LICENSE.
