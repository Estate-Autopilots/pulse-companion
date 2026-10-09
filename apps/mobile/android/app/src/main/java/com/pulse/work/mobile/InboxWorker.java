package com.pulse.work.mobile;

import android.content.Context;
import android.net.Uri;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The background check: every ~15 minutes (Android decides the exact moment) the shell asks Pulse's notification
 * outbox for new items with its own device credential and shows them as local notifications. When real push is
 * configured (Firebase), the push path delivers instead and this check only keeps the badge current.
 */
public class InboxWorker extends Worker {

    static final String PERIODIC = "pulse-inbox";
    static final String NOW = "pulse-inbox-now";

    public InboxWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        Shell.init(context);
        if (!ShellStore.enrolled(context)) return Result.success();
        try {
            check(context, !MainActivity.foreground && !PulseShellPlugin.pushActive(context));
            return Result.success();
        } catch (Gateway.Revoked e) {
            return Result.success();
        } catch (Gateway.Failed e) {
            if (e.status == 401) { Gateway.forget(context); return Result.success(); }
            return getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        } catch (IOException | JSONException e) {
            return getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        }
    }

    /** Read new outbox items once; notify when asked to; acknowledge what this phone received. */
    static int check(Context context, boolean notify) throws IOException, JSONException {
        String token = Gateway.accessToken(context);
        String cursor = ShellStore.plain(context, "cursor");
        String page = null;
        int total = 0;
        for (int round = 0; round < 5; round++) {
            StringBuilder path = new StringBuilder("companion/updates");
            String sep = "?";
            if (cursor != null) { path.append(sep).append("since=").append(Uri.encode(cursor)); sep = "&"; }
            if (page != null) path.append(sep).append("page=").append(Uri.encode(page));
            JSONObject state = Gateway.get(path.toString(), token);
            JSONObject counts = state.optJSONObject("counts");
            total = counts == null ? 0 : counts.optInt("total", 0);
            Notifier.badge(context, total);
            JSONArray rows = state.optJSONArray("rows");
            JSONArray received = new JSONArray();
            if (rows != null) for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                if (!row.optBoolean("pingAllowed")) continue;
                if (notify) Notifier.post(context, row.optString("id"), row.optString("title"), row.optString("detail", ""), row.optString("href", "/inbox"));
                received.put(row.optString("id"));
            }
            if (received.length() > 0) Gateway.post("companion/ack", Gateway.json("ids", received), token);
            cursor = state.optString("cursor", cursor);
            page = state.optBoolean("hasMore") ? state.optString("page", null) : null;
            ShellStore.plain(context, "cursor", cursor);
            if (page == null) break;
        }
        return total;
    }

    static void schedule(Context context) {
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest every = new PeriodicWorkRequest.Builder(InboxWorker.class, 15, TimeUnit.MINUTES).setConstraints(online).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, every);
    }

    static void runNow(Context context) {
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest once = new OneTimeWorkRequest.Builder(InboxWorker.class).setConstraints(online).build();
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, once);
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC);
        WorkManager.getInstance(context).cancelUniqueWork(NOW);
        Notifier.badge(context, 0);
    }
}
