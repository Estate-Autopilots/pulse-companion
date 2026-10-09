package com.pulse.work.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloads (payslips, policy PDFs, exports) are fetched with the page's own sign-in and opened in a viewer, or
 * offered to share when no viewer exists. Files stay in the app's private cache, never in shared storage.
 */
final class ShellDownloads implements DownloadListener {

    private static final long MAX = 50L * 1024 * 1024;
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    private final Activity activity;
    private final WebView web;

    ShellDownloads(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    @Override
    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if ("blob".equals(scheme) || "data".equals(scheme)) {
            // Files the page made itself: the page hands the bytes over through the bridge (PulseShell.saveFile).
            String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
            web.evaluateJavascript("(async()=>{try{const b=await (await fetch(" + quote(url) + ")).blob();const r=new FileReader();"
                + "r.onload=()=>window.Capacitor&&Capacitor.Plugins.PulseShell.saveFile({name:" + quote(name) + ",mime:b.type||" + quote(mimetype == null ? "" : mimetype)
                + ",base64:String(r.result).split(',')[1]});r.readAsDataURL(b);}catch(e){}})()", null);
            return;
        }
        if (!"https".equals(scheme) || !MainActivity.HOST.equals(uri.getHost())) {
            PulseShellPlugin.openExternal(activity, uri);
            return;
        }
        final String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
        final String cookies = CookieManager.getInstance().getCookie(url);
        Toast.makeText(activity, "Downloading " + name + "…", Toast.LENGTH_SHORT).show();
        WORK.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                if (cookies != null) c.setRequestProperty("Cookie", cookies);
                c.setRequestProperty("User-Agent", userAgent);
                if (c.getResponseCode() != 200) throw new IllegalStateException("HTTP " + c.getResponseCode());
                String type = c.getContentType() != null ? c.getContentType().split(";")[0].trim() : mimetype;
                File file = target(activity, name);
                long total = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = in.read(buffer)) > 0) {
                        total += n;
                        if (total > MAX) throw new IllegalStateException("Too large");
                        out.write(buffer, 0, n);
                    }
                } finally {
                    c.disconnect();
                }
                activity.runOnUiThread(() -> open(activity, file, type));
            } catch (Exception e) {
                activity.runOnUiThread(() -> Toast.makeText(activity, "The download did not finish. Check your connection and try again.", Toast.LENGTH_LONG).show());
            }
        });
    }

    static File target(Context context, String name) {
        File dir = new File(context.getCacheDir(), "downloads");
        dir.mkdirs();
        String safe = name.replaceAll("[^A-Za-z0-9._ -]", "_");
        if (safe.isEmpty() || safe.startsWith(".")) safe = "Pulse download" + safe;
        return new File(dir, safe);
    }

    /** Open in a viewer; without one, offer the share sheet. */
    static void open(Activity activity, File file, String mime) {
        String type = mime == null || mime.isEmpty() || "application/octet-stream".equals(mime)
            ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(Uri.fromFile(file).toString()))
            : mime;
        if (type == null) type = "application/octet-stream";
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivity(Intent.createChooser(view, "Open " + file.getName()));
        } catch (ActivityNotFoundException e) {
            share(activity, uri, type, file.getName());
        }
    }

    static void share(Activity activity, Uri uri, String type, String name) {
        Intent send = new Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivity(Intent.createChooser(send, "Share " + name));
    }

    private static String quote(String s) {
        return "'" + (s == null ? "" : s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "")) + "'";
    }
}
