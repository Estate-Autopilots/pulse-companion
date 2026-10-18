# Pulse phone shell

Android and iPhone wrap the Pulse web app. Native builds and emulator acceptance run on GitHub-hosted runners.
Run static checks with `pnpm --dir apps/mobile test` (on the VPS, through `/usr/local/bin/ea-heavy`).

`PULSE_ORIGIN=https://pulse.example.com pnpm --dir apps/mobile sync android` applies the single Android build
setting before Capacitor sync: config, redirect, offline recovery, Java host and verified App Links.
Omit `PULSE_ORIGIN` to restore the unchanged EA default. Only `https://` plus a lowercase DNS host is accepted;
ports, paths (including a trailing slash), queries, fragments and credentials are rejected.
Run tests before configuring an origin; tests use disposable copies to exercise both builds.

In the public phone workflow, dispatch `origin=https://<host>` and `signin_text` matching that install's sign-in
form (default `Username`). This builds and accepts Android only, retains the package/signing identity, and
publishes a host-specific pre-release and `android-<host>-entry.json` on `companion-phone`. Its tag appends
the first eight hex characters of SHA-256(origin) to the commit suffix. It does not move update channels or EA
download entries. A supplied origin takes precedence over `promote`; iPhone builds stay on the default origin.
Android's updater offers and downloads only release tags for its own origin: exactly seven commit hex characters
for EA's default build, or seven commit characters plus that origin's exact eight-character hash suffix.
