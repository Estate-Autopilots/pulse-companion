# Pulse for iPhone and Android

The app connects to https://pulse.estateautopilots.com by default. Approve its pairing code in your Pulse browser.
Long-press the Pulse heading on the sign-in screen to reveal the developer server setting.

## iPhone builds

The public workflow builds both an iPhone Simulator `.app` archive and an unsigned device `.app` archive.
The device archive needs Apple signing before installation; it is not an installable IPA.

On a Mac with Node from `.nvmrc`, Xcode and CocoaPods:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @pulse/mobile exec expo prebuild --platform ios --clean
xcodebuild -jobs 2 -workspace apps/mobile/ios/Pulse.xcworkspace -scheme Pulse -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/ios-simulator CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO
xcodebuild -jobs 2 -workspace apps/mobile/ios/Pulse.xcworkspace -scheme Pulse -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/ios-device CODE_SIGNING_ALLOWED=NO
```

For simulator installation, let Xcode generate the simulated entitlements and local ad-hoc signature as above.
Do not pass restricted iOS Keychain or App Group entitlements to a manual macOS codesign command. No Apple
account is used for simulator signing. The app requests no Associated Domains entitlement. The normal iOS
confirmation when opening a custom `pulse://` link is an operating-system prompt.

When the Apple Developer account exists:

1. In Apple Developer, register `com.pulse.work.mobile`, the widget extension `com.pulse.work.mobile.ExpoWidgetsTarget`,
   and App Group `group.com.pulse.work.mobile`. Enable App Groups on both identifiers; enable Access Wi-Fi Information
   on the main app. Do not enable Associated Domains for the custom scheme.
2. Open `apps/mobile/ios/Pulse.xcworkspace` in Xcode. Select the owner's team for both Pulse and ExpoWidgetsTarget,
   enable automatic signing, and confirm both targets have the shared App Group. Xcode supplies the team-prefixed
   application identifier and Keychain groups in the signed profile.
3. Choose a connected registered iPhone, select the Pulse scheme and Run. For TestFlight, choose Any iOS Device,
   Product → Archive → Distribute App → App Store Connect. Create the matching App Store Connect app record and
   complete the privacy details before uploading. Keep certificates and profiles outside this public repository.
4. For EAS instead, create the owner's EAS project, run `eas init`, `eas build:configure` and configure both app and
   extension credentials/App Group. Use a development profile for registered devices or production for TestFlight.

Long-press the iPhone home screen → Edit → Add Widget → Pulse. The working day also appears as a Live Activity
on the Lock Screen and Dynamic Island on supported iPhones. Break/Back/Check out links open Pulse and require
confirmation; old entry links cannot change a new attendance day. Notification reminders have attendance actions.
The widget and Live Activity keep no device token or person's name.

## Android

```sh
pnpm --filter @pulse/mobile exec expo prebuild --platform android --no-install --clean
cd apps/mobile/android
./gradlew assembleRelease --no-daemon --max-workers=2 -Dorg.gradle.parallel=false -PreactNativeArchitectures=arm64-v8a,x86_64
```

The workflow's generated test key makes the APK installable. Production updates need the owner's durable signing
key; a differently signed earlier test app must be uninstalled before this APK can replace it.
Allow notifications, then long-press the home screen → Widgets → Pulse. During work an ongoing notification shows
the timer and Break/Back/Check out actions. It ends on check-out or sign-out.

## Office presence

Allow region events and office Wi-Fi in the app, and separately opt into automatic office check-in. HR also has to
allow it and configure office coordinates, Wi-Fi BSSIDs, public IP ranges and dwell minutes. A region plus a registered
BSSID or office public IP establishes confidence; an SSID alone is weak. The server confirms attendance after dwell.
Wi-Fi loss does not undo a check-in while other signals hold. Leaving generates a reminder, then a proposed last-
presence check-out requiring confirmation. Current signals replace previous signals; no continuous location history.
