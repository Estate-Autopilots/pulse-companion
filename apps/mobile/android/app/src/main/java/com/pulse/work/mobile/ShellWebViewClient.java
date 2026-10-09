package com.pulse.work.mobile;

import android.net.Uri;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Never a Chrome error page: when Pulse cannot be reached the shell shows its own offline screen with Retry.
 * A Pulse page that answers with its own status (a 404, a sign-in page) is shown as Pulse rendered it.
 */
final class ShellWebViewClient extends BridgeWebViewClient {

    static final String OFFLINE = "https://localhost/offline.html";
    private final Bridge bridge;

    ShellWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    private static boolean pulse(Uri url) {
        return url != null && "https".equals(url.getScheme()) && MainActivity.HOST.equals(url.getHost());
    }

    static void showOffline(WebView view, String from, String why) {
        view.loadUrl(OFFLINE + "?why=" + why + "&from=" + Uri.encode(from));
    }

    // Capacitor's own handling would load server.errorPath for every failed request, even a Pulse 404; the shell
    // decides here instead (errorPath stays configured for iOS, where only network failures reach it).
    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame() && pulse(request.getUrl())) showOffline(view, request.getUrl().toString(), "offline");
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        int code = response.getStatusCode();
        boolean unreachable = code == 502 || code == 503 || code == 504 || (code >= 520 && code <= 530);
        if (request.isForMainFrame() && pulse(request.getUrl()) && unreachable) showOffline(view, request.getUrl().toString(), "server");
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        if (super.onRenderProcessGone(view, detail)) return true;
        // Android reclaimed or lost the page's renderer: start Pulse again instead of closing the app.
        bridge.getActivity().recreate();
        return true;
    }
}
