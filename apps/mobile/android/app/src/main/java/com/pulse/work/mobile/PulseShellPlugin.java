package com.pulse.work.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * The small typed bridge the Pulse web app feature-detects (apps/web/app/lib/native-shell.ts). Everything here is
 * something a browser cannot do; the page never sees the device credential.
 */
@CapacitorPlugin(
    name = "PulseShell",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class PulseShellPlugin extends Plugin {

    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    private JSONObject pairing;
    private long pairingAt;
    private String readyUpdate;

    @Override
    public void load() {
        Shell.init(getContext());
        Notifier.channels(getContext());
    }

    /** Links outside Pulse open in a Custom Tab (sign-in providers included), never inside the app's WebView. */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url.getScheme();
        String host = url.getHost();
        if (("http".equals(scheme) || "https".equals(scheme)) && host != null && !MainActivity.HOST.equals(host) && !"localhost".equals(host)) {
            openExternal(getActivity(), url);
            return true;
        }
        return null;
    }

    static void openExternal(Activity activity, Uri url) {
        try {
            int toolbar = Theme.chosenByPage ? 0xFF121219 : Theme.canvas(activity, Theme.systemDark(activity));
            new CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder().setToolbarColor(toolbar).build())
                .build()
                .launchUrl(activity, url);
        } catch (ActivityNotFoundException e) {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {}
        }
    }

    static boolean pushActive(Context context) {
        return ShellStore.plain(context, "push") != null;
    }

    @PluginMethod
    public void info(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("platform", "android");
        r.put("version", Shell.version());
        r.put("build", Shell.code());
        r.put("enrolled", ShellStore.enrolled(c));
        r.put("deviceId", ShellStore.enrolled(c) ? ShellStore.get(c, ShellStore.DEVICE) : null);
        r.put("personId", ShellStore.enrolled(c) ? ShellStore.get(c, ShellStore.PERSON) : null);
        r.put("notifications", Notifier.enabled(c));
        r.put("pushReady", firebaseReady());
        r.put("pushActive", pushActive(c));
        call.resolve(r);
    }

    private boolean firebaseReady() {
        try {
            Class<?> app = Class.forName("com.google.firebase.FirebaseApp");
            Object apps = app.getMethod("getApps", Context.class).invoke(null, getContext());
            return apps instanceof java.util.List && !((java.util.List<?>) apps).isEmpty();
        } catch (Throwable e) {
            return false;
        }
    }

    /** Step 1 of registering this phone: a pairing request whose poll secret never leaves the app. */
    @PluginMethod
    public void startEnrollment(PluginCall call) {
        WORK.execute(() -> {
            try {
                JSONObject body = new JSONObject().put("platform", "android").put("name", Shell.deviceName());
                JSONObject r = Gateway.post("native/pair/start", body, null);
                pairing = r;
                pairingAt = System.currentTimeMillis();
                JSObject out = new JSObject();
                out.put("code", r.getString("code"));
                out.put("replaces", ShellStore.enrolled(getContext()) ? ShellStore.get(getContext(), ShellStore.DEVICE) : null);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("Pulse could not start registering this phone. Check your connection.", "start");
            }
        });
    }

    /** Step 3: after the signed-in page approved the request, collect the device credential once. */
    @PluginMethod
    public void finishEnrollment(PluginCall call) {
        WORK.execute(() -> {
            JSONObject p = pairing;
            if (p == null || System.currentTimeMillis() - pairingAt > 9 * 60_000) {
                call.reject("Start registering this phone again.", "expired");
                return;
            }
            try {
                for (int i = 0; i < 6; i++) {
                    JSONObject body = new JSONObject().put("pairId", p.getString("pairId")).put("pollSecret", p.getString("pollSecret"));
                    JSONObject r = Gateway.post("native/pair/poll", body, null);
                    String status = r.optString("status");
                    if ("approved".equals(status)) {
                        Gateway.forget(getContext());
                        Gateway.remember(getContext(), r);
                        pairing = null;
                        InboxWorker.schedule(getContext());
                        health();
                        JSObject out = new JSObject();
                        out.put("deviceId", r.getString("deviceId"));
                        call.resolve(out);
                        return;
                    }
                    if (!"pending".equals(status)) break;
                    Thread.sleep(1000);
                }
                call.reject("This phone was not approved. Sign in again to register it.", "denied");
            } catch (Exception e) {
                call.reject("Pulse could not finish registering this phone. Check your connection.", "finish");
            }
        });
    }

    private void health() {
        try {
            String token = Gateway.accessToken(getContext());
            String device = ShellStore.get(getContext(), ShellStore.DEVICE);
            JSONObject caps = new JSONObject().put("push", firebaseReady() ? "healthy" : "unsupported");
            JSONObject body = new JSONObject().put("health", Notifier.enabled(getContext()) ? "healthy" : "permission_missing").put("appVersion", Shell.version()).put("capabilities", caps);
            Gateway.post("devices/" + device + "/health", body, token);
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void status(PluginCall call) {
        info(call);
    }

    /** Signing out on the phone: tell Pulse to revoke this device, then forget everything locally. */
    @PluginMethod
    public void signOut(PluginCall call) {
        WORK.execute(() -> {
            Context c = getContext();
            try {
                if (ShellStore.enrolled(c)) {
                    String device = ShellStore.get(c, ShellStore.DEVICE);
                    Gateway.post("devices/" + device + "/revoke", new JSONObject(), Gateway.accessToken(c));
                }
            } catch (Exception ignored) {
                // Already revoked by the web sign-out, or offline: the server ends it with the session anyway.
            }
            Gateway.forget(c);
            Notifier.badge(c, 0);
            call.resolve();
        });
    }

    /** Settings → Notifications → Turn on: Android's own prompt (Android 13+), then a confirmation notification. */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            notificationsAnswered(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        boolean on = Notifier.enabled(getContext());
        if (on) Notifier.confirm(getContext());
        JSObject r = new JSObject();
        r.put("state", on ? "granted" : "denied");
        call.resolve(r);
    }

    /** Ask Pulse's outbox now (the page calls this after sign-in and when it comes back to the front). */
    @PluginMethod
    public void checkInbox(PluginCall call) {
        if (ShellStore.enrolled(getContext())) InboxWorker.runNow(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setBadge(PluginCall call) {
        Notifier.badge(getContext(), call.getInt("count", 0));
        call.resolve();
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        Theme.chosenByPage = true;
        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().setBackgroundColor(Theme.canvas(getContext(), dark));
            Theme.apply(getActivity(), dark);
            call.resolve();
        });
    }

    /** Push seam: once the owner's Firebase project exists, the page registers and the token reaches Pulse here. */
    @PluginMethod
    public void setPushToken(PluginCall call) {
        String token = call.getString("token");
        WORK.execute(() -> {
            Context c = getContext();
            try {
                String device = ShellStore.get(c, ShellStore.DEVICE);
                if (device == null) throw new IllegalStateException("not registered");
                Gateway.post("devices/" + device + "/push", new JSONObject().put("token", token == null ? JSONObject.NULL : token), Gateway.accessToken(c));
                ShellStore.plain(c, "push", token);
                call.resolve();
            } catch (Exception e) {
                call.reject("Pulse could not register this phone for pings.", "push");
            }
        });
    }

    /** Office Wi-Fi for check-in: name and access point. Needs the location permission (asked on a tap). */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void wifi(PluginCall call) {
        JSObject r = new JSObject();
        if (getPermissionState("location") != PermissionState.GRANTED) {
            r.put("permission", "denied");
            call.resolve(r);
            return;
        }
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiInfo info = wifi == null ? null : wifi.getConnectionInfo();
        String ssid = info == null ? null : info.getSSID();
        if (ssid != null) ssid = ssid.replaceAll("^\"|\"$", "");
        String bssid = info == null ? null : info.getBSSID();
        boolean connected = ssid != null && !ssid.isEmpty() && !"<unknown ssid>".equals(ssid);
        r.put("permission", "granted");
        r.put("connected", connected);
        r.put("ssid", connected ? ssid : null);
        r.put("bssid", connected && bssid != null && !"02:00:00:00:00:00".equals(bssid) ? bssid.toLowerCase() : null);
        call.resolve(r);
    }

    /** One position, only when the person taps for it. Nothing is kept by the shell. */
    @PluginMethod
    @SuppressWarnings({ "deprecation", "MissingPermission" })
    public void location(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is off for Pulse.", "permission");
            return;
        }
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        String provider = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ? LocationManager.NETWORK_PROVIDER
            : lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER : null;
        if (provider == null) {
            call.reject("Turn on Location in Android settings.", "off");
            return;
        }
        Handler main = new Handler(Looper.getMainLooper());
        final boolean[] done = { false };
        java.util.function.Consumer<Location> answer = location -> {
            if (done[0]) return;
            done[0] = true;
            if (location == null) {
                call.reject("Pulse could not read your position. Try again by a window.", "unavailable");
                return;
            }
            JSObject r = new JSObject();
            r.put("lat", location.getLatitude());
            r.put("lng", location.getLongitude());
            r.put("accuracy", location.getAccuracy());
            r.put("at", location.getTime());
            call.resolve(r);
        };
        main.postDelayed(() -> answer.accept(null), 20000);
        if (Build.VERSION.SDK_INT >= 30) {
            lm.getCurrentLocation(provider, new CancellationSignal(), getContext().getMainExecutor(), answer);
        } else {
            lm.requestSingleUpdate(provider, new android.location.LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    answer.accept(location);
                }
            }, Looper.getMainLooper());
        }
    }

    @PluginMethod
    public void checkUpdate(PluginCall call) {
        WORK.execute(() -> {
            try {
                JSONObject c = Updater.candidate();
                JSObject r = new JSObject();
                r.put("current", Shell.version());
                r.put("available", c != null && c.optBoolean("available"));
                if (c != null) {
                    r.put("version", c.optString("version"));
                    r.put("size", c.optLong("size"));
                    r.put("notes", c.optString("notes"));
                }
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Pulse could not check for updates. Try again when you're online.", "check");
            }
        });
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        WORK.execute(() -> {
            try {
                JSONObject c = Updater.candidate();
                if (c == null || !c.optBoolean("available")) {
                    call.reject("Pulse is up to date.", "none");
                    return;
                }
                readyUpdate = Updater.download(getContext(), c.getString("url"), c.getString("sha256"), c.getLong("size"));
                JSObject r = new JSObject();
                r.put("version", c.getString("version"));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Pulse could not verify the update. Check your connection; a build with a different signing key cannot replace this app.", "download");
            }
        });
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        try {
            if (readyUpdate == null) {
                call.reject("Download the update first.", "missing");
                return;
            }
            JSObject r = new JSObject();
            r.put("result", Updater.install(getContext(), readyUpdate));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Android could not open the Pulse installer. Try again.", "install");
        }
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Updater.openInstallSettings(getContext());
        call.resolve();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = Build.VERSION.SDK_INT >= 26
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme())) {
            call.reject("Only https links open outside Pulse.", "scheme");
            return;
        }
        getActivity().runOnUiThread(() -> {
            openExternal(getActivity(), uri);
            call.resolve();
        });
    }

    /** A file the page generated itself (an export): keep it privately and open or share it. */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "Pulse download");
        String mime = call.getString("mime", "application/octet-stream");
        String data = call.getString("base64", "");
        WORK.execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                if (bytes.length > 50 * 1024 * 1024) throw new IllegalStateException("Too large");
                File file = ShellDownloads.target(getContext(), name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                getActivity().runOnUiThread(() -> ShellDownloads.open(getActivity(), file, mime));
                call.resolve();
            } catch (Exception e) {
                call.reject("Pulse could not save the file.", "save");
            }
        });
    }
}
