# Pulse apps — client apps for Pulse by Estate Autopilots

The full Pulse in its own desktop window with a tray/menu-bar quick panel, iPhone and Android apps, and a Chrome extension for https://pulse.estateautopilots.com.
Approve an app’s pairing code in your Pulse browser. Attendance follows My desk; device access is revocable in Settings → Devices.

Client source only, with fresh history. No Pulse server, employee records, research, credentials or signing keys.
GitHub Actions produces Windows MSI/EXE, universal macOS DMG, Android APK, unsigned iOS Simulator and device archives, and a Chrome ZIP.
Desktop update bundles have Tauri signatures, and Android APKs use a persistent Pulse signing identity. Windows and macOS distribution signing is still pending, so the OS may show a warning on the first installation. iPhone installation needs Apple/TestFlight access.

Install an updater-enabled version once from the public releases: choose Windows Setup (.exe) for your Windows account, or drag the Mac app from its DMG into a writable Applications folder. Sign in with your Pulse account. Pip then offers “A new Pulse is ready” with Install and restart / Later. Updates wait for attendance actions and queued work; Later postpones the offer for four hours. Recovery retains the previous app after two failed starts. Managed, machine-wide MSI rollback has not been verified.

From 1.0 every Mac build is signed with one stable Estate Autopilots identity, so updates keep you signed in without Keychain prompts; coming from an earlier test version, Pulse asks you to sign in once more. Saved sign-ins are never read with a Keychain prompt.

Every accepted Companion change is exported through a reviewed client-only allowlist to this repository. A main commit starts hosted builds and required acceptance, then publishes a versioned public release with installers, signed updater bundles, latest.json and SHA256SUMS.txt. The test channel pointer advances only after publication succeeds. Get the apps and installed clients read that same manifest.

Build: Node from `.nvmrc`, `corepack enable`, `pnpm install --frozen-lockfile`.
Desktop: `pnpm --dir apps/desktop run build`, then `pnpm --dir apps/desktop exec tauri build` on Windows or macOS.
Phone: `pnpm --dir apps/mobile exec expo prebuild --clean`, then Gradle or Xcode as in the workflow.
Chrome: `node apps/chrome-extension/scripts/package.mjs pulse-chrome.zip`.
Worker cap: two. Workspace checks run sequentially.

All rights reserved. See LICENSE.
