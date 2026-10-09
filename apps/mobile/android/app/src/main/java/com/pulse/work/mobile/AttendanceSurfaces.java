package com.pulse.work.mobile;

import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.os.Build;
import android.provider.Settings;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.io.IOException;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** Cached self-only presentation. All taps open the authenticated web desk; no background attendance writes. */
final class AttendanceSurfaces {
    static final String CHANNEL = "pulse-attendance";
    static final String KEY = "attendance-surface";
    static final String PENDING = "attendance-surface-pending";
    static final String NONCE = "attendance-surface-nonce";
    static final String RIBBON = "attendance-ribbon";
    static final String EXTRA_NONCE = "pulse.surface.nonce";
    static final String EXTRA_ACTION = "pulse.surface.action";
    static final int NOTIFICATION = 2101;

    private AttendanceSurfaces() {}
    static long boot(Context c) { return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, -1); }
    static JSONObject read(Context c) {
        try { String value = ShellStore.get(c, KEY); return value == null ? null : new JSONObject(value); }
        catch (JSONException | IllegalStateException e) { return null; }
    }
    static boolean fresh(Context c, JSONObject s) {
        return s != null && boot(c) >= 0 && SurfacePolicy.fresh(s.optLong("boot", -2), boot(c), s.optLong("elapsed", -1), SystemClock.elapsedRealtime())
            && ShellStore.enrolled(c) && s.optString("device").equals(ShellStore.get(c, ShellStore.DEVICE));
    }
    static String nonce(Context c) {
        String n = ShellStore.get(c, NONCE);
        if (n == null) { n = UUID.randomUUID().toString(); ShellStore.put(c, NONCE, n); }
        return n;
    }
    static PendingIntent tap(Context c, String action) {
        Intent open = new Intent(c, MainActivity.class).setAction("pulse.surface." + action)
            .putExtra(MainActivity.EXTRA_HREF, "/me").putExtra(EXTRA_ACTION, action).putExtra(EXTRA_NONCE, nonce(c))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 2100 + action.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    /** External links/extras cannot create a pending attendance intent without this installation's sealed nonce. */
    static void accept(Context c, Intent intent) {
        String action = intent.getStringExtra(EXTRA_ACTION), n = intent.getStringExtra(EXTRA_NONCE);
        intent.removeExtra(EXTRA_ACTION); intent.removeExtra(EXTRA_NONCE);
        if (action == null || n == null || !n.equals(ShellStore.get(c, NONCE))) return;
        if ("open".equals(action)) return;
        JSONObject s = read(c);
        if (!fresh(c, s) || !action.equals(SurfacePolicy.primary(s.optString("state"), s.optBoolean("enabled")))) return;
        try {
            JSONObject p = new JSONObject().put("action", action).put("person", s.getString("person")).put("device", s.getString("device"))
                .put("boot", boot(c)).put("elapsed", SystemClock.elapsedRealtime());
            // Repeated taps are one intent; confirmation (not the stale widget time) becomes the queue timestamp.
            ShellStore.put(c, PENDING, p.toString());
        } catch (JSONException ignored) {}
    }
    /** Revalidate the device on a cold tap before exposing a confirmation to the signed-in web person. */
    static JSONObject take(Context c, String person) throws IOException, JSONException {
        synchronized (Gateway.class) {
            if (c.getSystemService(KeyguardManager.class).isDeviceLocked()) return new JSONObject();
            String raw = ShellStore.get(c, PENDING);
            if (raw == null) return new JSONObject();
            JSONObject p = new JSONObject(raw);
            if (!SurfacePolicy.fresh(p.optLong("boot", -2), boot(c), p.optLong("elapsed", -1), SystemClock.elapsedRealtime())
                || !p.optString("person").equals(person) || !p.optString("device").equals(ShellStore.get(c, ShellStore.DEVICE))) {
                clearPending(c); return new JSONObject();
            }
            // Loads/rotates the Keystore-backed credential BEFORE validating current server state.
            JSONObject day = current(c, person);
            String action = p.getString("action");
            clearPending(c);
            if (!action.equals(SurfacePolicy.primary(day.optString("state"), day.optBoolean("attendanceEnabled")))) return new JSONObject();
            return new JSONObject().put("action", action).put("personId", person);
        }
    }
    static JSONObject current(Context c, String person) throws IOException, JSONException {
        synchronized (Gateway.class) {
            if (person == null || !person.equals(ShellStore.get(c, ShellStore.PERSON))) throw new Gateway.Revoked();
            JSONObject day;
            try { day = Gateway.get("companion", Gateway.accessToken(c)); }
            catch (Gateway.Failed e) { if (e.status == 401) { Gateway.forget(c); throw new Gateway.Revoked(); } throw e; }
            JSONObject who = day.optJSONObject("person");
            if (who == null || !person.equals(who.optString("id"))) { Gateway.forget(c); throw new Gateway.Revoked(); }
            JSONObject s = new JSONObject().put("state", day.optBoolean("attendanceEnabled") ? day.optString("state", "unknown") : "unavailable")
                .put("enabled", day.optBoolean("attendanceEnabled")).put("updated", day.optString("now"))
                .put("person", person).put("device", ShellStore.get(c, ShellStore.DEVICE))
                .put("boot", boot(c)).put("elapsed", SystemClock.elapsedRealtime());
            ShellStore.put(c, KEY, s.toString()); render(c);
            return day;
        }
    }
    static void clearPending(Context c) { ShellStore.put(c, PENDING, "{}"); }
    static boolean ribbon(Context c) { return "on".equals(ShellStore.get(c, RIBBON)); }
    static void chooseRibbon(Context c, boolean enabled) {
        ShellStore.put(c, RIBBON, enabled ? "on" : "off"); render(c);
    }
    static void clear(Context c) {
        NotificationManagerCompat.from(c).cancel(NOTIFICATION);
        renderWidget(c);
    }
    static void render(Context c) { renderWidget(c); renderRibbon(c); }
    static void renderWidget(Context c) {
        JSONObject s = read(c);
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        int[] ids = manager.getAppWidgetIds(new ComponentName(c, AttendanceWidget.class));
        if (ids.length == 0) return;
        boolean valid = fresh(c, s);
        RemoteViews view = new RemoteViews(c.getPackageName(), R.layout.attendance_widget);
        view.setTextViewText(R.id.attendance_status, s == null ? "Open Pulse to sign in" : "Last confirmed: " + SurfacePolicy.title(s.optString("state")));
        String stamp = "unknown";
        if (s != null) try {
            java.text.SimpleDateFormat parser = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            parser.setTimeZone(java.util.TimeZone.getTimeZone("UTC")); parser.setLenient(false);
            stamp = new java.text.SimpleDateFormat("MMM d, HH:mm", java.util.Locale.getDefault()).format(parser.parse(s.optString("updated")));
        } catch (Exception ignored) {}
        String updated = s == null ? "No saved status" : "Updated " + stamp;
        view.setTextViewText(R.id.attendance_updated, updated + (valid ? " · Open to refresh" : " · Stale, open to refresh"));
        String action = valid ? SurfacePolicy.primary(s.optString("state"), s.optBoolean("enabled")) : "open";
        view.setTextViewText(R.id.attendance_primary, "check-in".equals(action) ? "Open to check in" : "check-out".equals(action) ? "Open to check out" : "Open Workspace");
        view.setOnClickPendingIntent(R.id.attendance_primary, tap(c, action));
        manager.updateAppWidget(ids, view);
    }
    static boolean ribbonAllowed(Context c) {
        if (!Notifier.enabled(c)) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    static void renderRibbon(Context c) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(c);
        JSONObject s = read(c);
        if (!ribbon(c) || !ribbonAllowed(c) || !fresh(c, s)) { manager.cancel(NOTIFICATION); return; }
        NotificationManager nativeManager = c.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Attendance shortcuts", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Optional, dismissible shortcuts to confirm attendance in Pulse."); channel.setShowBadge(false);
            nativeManager.createNotificationChannel(channel);
        }
        Intent dismiss = new Intent(c, AttendanceWidget.class).setAction(AttendanceWidget.DISMISS);
        PendingIntent deleted = PendingIntent.getBroadcast(c, 2101, dismiss, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_pulse).setContentTitle("Pulse Workspace")
            .setContentText("Attendance shortcuts · Open to confirm")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_pulse)
                .setContentTitle("Pulse Workspace").setContentText("Open Workspace").setContentIntent(tap(c, "open")).build()).setOnlyAlertOnce(true).setAutoCancel(false).setOngoing(false)
            .setContentIntent(tap(c, "open")).setDeleteIntent(deleted);
        String action = SurfacePolicy.primary(s.optString("state"), s.optBoolean("enabled"));
        if (!"open".equals(action)) b.addAction(0, "check-in".equals(action) ? "Check in" : "Done / check out", tap(c, action));
        b.addAction(0, "Open Workspace", tap(c, "open"));
        try { manager.notify(NOTIFICATION, b.build()); } catch (SecurityException ignored) {}
    }
}
