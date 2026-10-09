package com.pulse.work.mobile;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/** Launcher updates only: no alarms, foreground service, sensor or attendance transport. */
public class AttendanceWidget extends AppWidgetProvider {
    static final String DISMISS = "com.pulse.work.mobile.DISMISS_ATTENDANCE";
    @Override public void onUpdate(Context c, AppWidgetManager manager, int[] ids) { AttendanceSurfaces.render(c); }
    @Override public void onReceive(Context c, Intent intent) {
        if (DISMISS.equals(intent.getAction())) { AttendanceSurfaces.chooseRibbon(c, false); return; }
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) { AttendanceSurfaces.render(c); return; }
        super.onReceive(c, intent);
    }
}
