package com.pulse.work.mobile;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.NotificationManager;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.FixMethodOrder;
import org.junit.runners.MethodSorters;

/** Native emulator fixtures: fake self IDs, no HTTP writes, no real staff session. */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class AttendanceSurfacesTest {
    Context c;
    @Before public void start() { Gateway.transport = Gateway::http; c = InstrumentationRegistry.getInstrumentation().getTargetContext(); Gateway.forget(c); }
    @After public void finish() { Gateway.transport = Gateway::http; Gateway.forget(c); }
    JSONObject fixture(String state) throws Exception {
        ShellStore.put(c, ShellStore.DEVICE, "synthetic-surface-device");
        ShellStore.put(c, ShellStore.PERSON, "synthetic-surface-person");
        ShellStore.put(c, ShellStore.REFRESH, "synthetic-placeholder-never-transported");
        JSONObject s = new JSONObject().put("state", state).put("enabled", true).put("updated", "2026-10-09T19:00:00.000Z")
            .put("person", "synthetic-surface-person").put("device", "synthetic-surface-device").put("boot", AttendanceSurfaces.boot(c)).put("elapsed", SystemClock.elapsedRealtime());
        ShellStore.put(c, AttendanceSurfaces.KEY, s.toString()); return s;
    }
    Intent intent(String action) {
        return new Intent().putExtra(AttendanceSurfaces.EXTRA_ACTION, action).putExtra(AttendanceSurfaces.EXTRA_NONCE, AttendanceSurfaces.nonce(c));
    }
    @Test public void sealedStorageSurvivesReadAndRejectsForgedDuplicateAndChangedAccountTaps() throws Exception {
        fixture("out");
        assertEquals("synthetic-placeholder-never-transported", ShellStore.get(c, ShellStore.REFRESH));
        AttendanceSurfaces.accept(c, new Intent().putExtra(AttendanceSurfaces.EXTRA_ACTION, "check-in").putExtra(AttendanceSurfaces.EXTRA_NONCE, "forged"));
        assertNull(ShellStore.get(c, AttendanceSurfaces.PENDING));
        AttendanceSurfaces.accept(c, intent("check-in")); AttendanceSurfaces.accept(c, intent("check-in"));
        JSONObject p = new JSONObject(ShellStore.get(c, AttendanceSurfaces.PENDING));
        assertEquals("check-in", p.getString("action"));
        assertEquals(0, AttendanceSurfaces.take(c, "different-person").length());
    }
    @Test public void staleAndRebootFixturesCannotCreateAttendanceIntent() throws Exception {
        JSONObject s = fixture("in"); s.put("elapsed", SystemClock.elapsedRealtime() - SurfacePolicy.FRESH_MS);
        ShellStore.put(c, AttendanceSurfaces.KEY, s.toString());
        AttendanceSurfaces.accept(c, intent("check-out")); assertNull(ShellStore.get(c, AttendanceSurfaces.PENDING));
        s.put("elapsed", SystemClock.elapsedRealtime()).put("boot", AttendanceSurfaces.boot(c) - 1);
        ShellStore.put(c, AttendanceSurfaces.KEY, s.toString());
        AttendanceSurfaces.accept(c, intent("check-out")); assertNull(ShellStore.get(c, AttendanceSurfaces.PENDING));
    }
    @Test public void coldActionLoadsCredentialBeforeAnyServerStateOrQueueConfirmation() throws Exception {
        fixture("out"); AttendanceSurfaces.accept(c, intent("check-in"));
        java.util.List<String> calls = new java.util.ArrayList<>();
        JSONObject tokens = new JSONObject().put("refreshToken", "synthetic-rotated").put("accessToken", "synthetic-access").put("expiresIn", 900);
        JSONObject day = new JSONObject().put("person", new JSONObject().put("id", "synthetic-surface-person")).put("state", "out").put("attendanceEnabled", true).put("now", "2026-10-09T19:00:00.000Z");
        Gateway.transport = (method, url, body, bearer) -> {
            calls.add(method + " " + url.substring(Gateway.BASE.length()));
            if (url.endsWith("native/refresh")) { assertEquals("synthetic-placeholder-never-transported", body.optString("refreshToken")); return tokens; }
            assertEquals("GET", method); assertEquals("synthetic-access", bearer); return day;
        };
        JSONObject confirmation = AttendanceSurfaces.take(c, "synthetic-surface-person");
        assertEquals("check-in", confirmation.getString("action"));
        assertEquals(java.util.Arrays.asList("POST native/refresh", "GET companion"), calls);
        assertEquals("synthetic-rotated", ShellStore.get(c, ShellStore.REFRESH));
        assertEquals(0, AttendanceSurfaces.take(c, "synthetic-surface-person").length());
        // Detected server revocation clears state. The adapter sends nothing to production.
        Gateway.forget(c); fixture("out"); AttendanceSurfaces.accept(c, intent("check-in"));
        Gateway.transport = (method, url, body, bearer) -> { throw new Gateway.Failed(401, "Synthetic revoked device"); };
        try { AttendanceSurfaces.take(c, "synthetic-surface-person"); fail("Revoked credential allowed confirmation"); }
        catch (Gateway.Revoked expected) { assertNull(AttendanceSurfaces.read(c)); assertFalse(AttendanceSurfaces.ribbon(c)); }
        // A restored/cold installation with no credential must stop before any transport.
        ShellStore.put(c, ShellStore.PERSON, "synthetic-surface-person"); ShellStore.put(c, ShellStore.DEVICE, "synthetic-surface-device");
        JSONObject pending = new JSONObject().put("person", "synthetic-surface-person").put("device", "synthetic-surface-device")
            .put("action", "check-in").put("boot", AttendanceSurfaces.boot(c)).put("elapsed", SystemClock.elapsedRealtime());
        ShellStore.put(c, AttendanceSurfaces.PENDING, pending.toString());
        Gateway.transport = (method, url, body, bearer) -> { throw new AssertionError("Missing credential reached transport"); };
        try { AttendanceSurfaces.take(c, "synthetic-surface-person"); fail("Absent credential allowed confirmation"); }
        catch (Gateway.Revoked expected) { /* accessToken fails before any HTTP read or write */ }
    }
    @Test public void dismissedRibbonStaysOffThroughRefreshAndLogoutClearsAllState() throws Exception {
        fixture("in"); assertFalse(AttendanceSurfaces.ribbon(c));
        AttendanceSurfaces.chooseRibbon(c, true);
        new AttendanceWidget().onReceive(c, new Intent(AttendanceWidget.DISMISS));
        AttendanceSurfaces.render(c); assertFalse(AttendanceSurfaces.ribbon(c));
        Gateway.forget(c); assertNull(AttendanceSurfaces.read(c)); assertFalse(AttendanceSurfaces.ribbon(c));
    }
    @Test public void genericLockScreenCopyAndRealNotificationPermissionBoundary() throws Exception {
        fixture("in"); AttendanceSurfaces.chooseRibbon(c, true);
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        android.service.notification.StatusBarNotification found = null;
        for (android.service.notification.StatusBarNotification n : manager.getActiveNotifications()) if (n.getId() == AttendanceSurfaces.NOTIFICATION) found = n;
        if (Notifier.enabled(c)) {
            assertNotNull(found); Notification n = found.getNotification(); assertNotNull(n.publicVersion);
            assertEquals("Open Workspace", n.publicVersion.extras.getString(Notification.EXTRA_TEXT));
            assertNull(n.publicVersion.actions); assertEquals(0, n.flags & Notification.FLAG_ONGOING_EVENT);
            assertEquals(2, n.actions.length);
        } else assertNull(found);
    }
    @Test public void zRealWidgetProviderInflatesAndColdPendingIntentOpensWorkspace() throws Exception {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        AppWidgetProviderInfo provider = manager.getInstalledProviders().stream().filter(p -> p.provider.equals(new ComponentName(c, AttendanceWidget.class))).findFirst().orElse(null);
        assertNotNull(provider); assertEquals(AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN, provider.widgetCategory);
        AppWidgetHost[] host = new AppWidgetHost[1]; AppWidgetHostView[] view = new AppWidgetHostView[1]; int[] id = new int[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            host[0] = new AppWidgetHost(c, 2101); id[0] = host[0].allocateAppWidgetId();
            assertTrue("Emulator-only widget host permission missing", manager.bindAppWidgetIdIfAllowed(id[0], provider.provider));
            view[0] = host[0].createView(c, id[0], provider); host[0].startListening();
        });
        try {
            fixture("in"); AttendanceSurfaces.renderWidget(c);
            for (int attempt = 0; attempt < 30; attempt++) {
                InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                android.widget.TextView status = view[0].findViewById(R.id.attendance_status);
                if (status != null && status.getText().toString().contains("Checked in")) break;
                SystemClock.sleep(100);
            }
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                android.widget.TextView status = view[0].findViewById(R.id.attendance_status);
                assertNotNull(status); assertEquals("Last confirmed: Checked in", status.getText().toString());
                android.widget.TextView updated = view[0].findViewById(R.id.attendance_updated);
                assertTrue(updated.getText().toString().contains("Updated")); assertTrue(updated.getText().toString().contains("Open to refresh"));
                int width = Math.round(300 * c.getResources().getDisplayMetrics().density), height = Math.round(190 * c.getResources().getDisplayMetrics().density);
                view[0].measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
                view[0].layout(0, 0, width, height);
                android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888);
                view[0].draw(new android.graphics.Canvas(bitmap));
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(c.getExternalFilesDir(null), "r21-widget.png"))) { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out); }
                catch (java.io.IOException e) { throw new AssertionError(e); }
            });
            // Clear credentials first: the real signed-out widget PendingIntent is safe on a cold app.
            Gateway.forget(c);
            for (int attempt = 0; attempt < 30; attempt++) {
                InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                android.widget.TextView button = view[0].findViewById(R.id.attendance_primary);
                if (button != null && "Open Workspace".equals(button.getText().toString())) break;
                SystemClock.sleep(100);
            }
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                android.widget.TextView button = view[0].findViewById(R.id.attendance_primary);
                assertNotNull(button); assertEquals("Open Workspace", button.getText().toString()); button.performClick();
            });
        } finally { host[0].stopListening(); host[0].deleteAppWidgetId(id[0]); }
    }
}
