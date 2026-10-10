package com.pulse.work.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Local notifications for chat messages, requests and approvals from Pulse's notification outbox. Texts are the
 * outbox's generic titles ("New message in a conversation"); message contents are never shown.
 */
final class Notifier {

    static final String UPDATES = "pulse-updates";
    static final String APP = "pulse-app";
    private static final String GROUP = "pulse";
    private static volatile int count = 0;

    private Notifier() {}

    static void channels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel updates = new NotificationChannel(UPDATES, "Messages, requests and approvals", NotificationManager.IMPORTANCE_HIGH);
        updates.setDescription("New messages in your chats, requests waiting for you and decisions on yours.");
        updates.setShowBadge(true);
        manager.createNotificationChannel(updates);
        NotificationChannel app = new NotificationChannel(APP, "Pulse app", NotificationManager.IMPORTANCE_LOW);
        app.setDescription("Downloads and app updates.");
        app.setShowBadge(false);
        manager.createNotificationChannel(app);
    }

    static boolean enabled(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    /** One notification per outbox item; tapping it opens that page in Pulse. */
    static void post(Context context, String id, String title, String body, String href) {
        post(context, id, title, body, href, null);
    }

    /** PRESENCE-ONBOARD: attendance questions carry their one-tap answer (see {@link AttendanceAction}). */
    static String answer(String eventType) {
        if (eventType == null) return null;
        switch (eventType) {
            case "attendance.arrival": case "attendance.start": case "attendance.nudge": return "check-in";
            case "attendance.break": return "break-end";
            case "attendance.end": case "attendance.done": case "attendance.departure": return "check-out";
            default: return null;
        }
    }

    static void post(Context context, String id, String title, String body, String href, String eventType) {
        if (!enabled(context) || id == null || title == null || title.isEmpty()) return;
        Intent open = new Intent(context, MainActivity.class)
            .setAction("com.pulse.work.mobile.OPEN." + id)
            .putExtra(MainActivity.EXTRA_HREF, href != null && href.startsWith("/") && !href.startsWith("//") ? href : "/inbox")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, UPDATES)
            .setSmallIcon(R.drawable.ic_stat_pulse)
            .setColor(0xFF5B45D6)
            .setContentTitle(title)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup(GROUP)
            .setNumber(Math.max(count, 1));
        if (body != null && !body.isEmpty()) b.setContentText(body);
        String answer = answer(eventType);
        if (answer != null) {
            // The lock screen shows only "Pulse · attendance"; the button works after unlocking.
            b.setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPublicVersion(new NotificationCompat.Builder(context, UPDATES).setSmallIcon(R.drawable.ic_stat_pulse).setContentTitle("Pulse · attendance").build())
                .addAction(new NotificationCompat.Action.Builder(0, "check-in".equals(answer) ? "Check in" : "break-end".equals(answer) ? "Back" : "Check out",
                    AttendanceAction.intent(context, answer, id)).setAuthenticationRequired(true).build());
        }
        try {
            NotificationManagerCompat.from(context).notify(id, 1, b.build());
        } catch (SecurityException ignored) {
            // Permission withdrawn between the check and the post.
        }
    }

    /** The answer to an attendance notification replaces it: done, or open My desk to finish. */
    static void attendanceDone(Context context, String id, String title, String text) {
        Intent open = new Intent(context, MainActivity.class).setAction("com.pulse.work.mobile.DAY." + id)
            .putExtra(MainActivity.EXTRA_HREF, "/me?tab=attendance").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, ("day" + id).hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, UPDATES).setSmallIcon(R.drawable.ic_stat_pulse).setColor(0xFF5B45D6)
            .setContentTitle(title).setAutoCancel(true).setContentIntent(tap).setOnlyAlertOnce(true).setTimeoutAfter(10 * 60_000)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        if (text != null) b.setContentText(text);
        try { NotificationManagerCompat.from(context).notify(id, 1, b.build()); } catch (SecurityException ignored) {}
    }

    /** "09:58" on the organisation's clock from an ISO time. */
    static String clock(String iso, int offsetMinutes) {
        if (iso == null || iso.isEmpty()) return null;
        // minSdk 24: no java.time; the same parsing as the attendance widget.
        for (String pattern : new String[] { "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'" }) {
            try {
                java.text.SimpleDateFormat in = new java.text.SimpleDateFormat(pattern, java.util.Locale.US);
                in.setTimeZone(java.util.TimeZone.getTimeZone("UTC")); in.setLenient(false);
                java.text.SimpleDateFormat out = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US);
                out.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                return out.format(new java.util.Date(in.parse(iso).getTime() + offsetMinutes * 60_000L));
            } catch (Exception ignored) {}
        }
        return null;
    }

    /** Shown right after notifications are turned on, so the person sees what a Pulse notification looks like. */
    static void confirm(Context context) {
        post(context, "pulse-notifications-on", "Notifications are on", "New messages, requests waiting for you and decisions on yours will appear here.", "/settings?tab=devices");
    }

    /** The launcher badge on Android is the number carried by Pulse's notifications; 0 clears them. */
    static void badge(Context context, int value) {
        count = Math.max(0, value);
        if (count == 0) {
            NotificationManagerCompat.from(context).cancelAll();
            AttendanceSurfaces.renderRibbon(context);
        }
    }

    static void app(Context context, int id, String title, String text, PendingIntent tap) {
        if (!enabled(context)) return;
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, APP)
            .setSmallIcon(R.drawable.ic_stat_pulse)
            .setColor(0xFF5B45D6)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true);
        if (tap != null) b.setContentIntent(tap);
        try {
            NotificationManagerCompat.from(context).notify(id, b.build());
        } catch (SecurityException ignored) {}
    }
}
