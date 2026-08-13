package com.deeptutor.scoreboost;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import android.util.Base64;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 401;
    private static final int AUDIO_PERMISSION_REQUEST = 402;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingAudioRequest;
    private final Object audioCaptureLock = new Object();
    private volatile AudioRecord audioRecord;
    private volatile Thread audioCaptureThread;
    private volatile boolean nativeMicrophoneMuted;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        configureEdgeToEdge();
        setContentView(buildView());
        loadScoreBoost();
    }

    private View buildView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        configureWebView();

        FrameLayout safeArea = new FrameLayout(this);
        safeArea.setBackgroundColor(Color.WHITE);
        safeArea.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        safeArea.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = 0;
            int bottom = 0;
            int left = 0;
            int right = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets systemBars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                top = systemBars.top;
                bottom = systemBars.bottom;
                left = systemBars.left;
                right = systemBars.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }
            view.setPadding(left, top, right, bottom);
            return insets;
        });
        safeArea.post(safeArea::requestApplyInsets);
        return safeArea;
    }

    private void configureEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
    }

    private void configureWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        webView.addJavascriptInterface(new NativeAudioBridge(), "NianNianNativeAudio");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                Log.i("NianNianWeb", "page started=" + url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i("NianNianWeb", "page finished=" + url);
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    android.webkit.WebResourceError error
            ) {
                if (request != null && request.isForMainFrame()) {
                    Log.e("NianNianWeb", "main frame error=" + error.getErrorCode());
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Let the server complete redirects. Rewriting /home back to
                // /space/score here creates an infinite redirect loop on WebView.
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    request.deny();
                    return;
                }
                boolean audioOnly = request.getResources().length == 1
                        && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(request.getResources()[0]);
                if (!audioOnly) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    return;
                }
                if (pendingAudioRequest != null) pendingAudioRequest.deny();
                pendingAudioRequest = request;
                requestPermissions(
                        new String[]{Manifest.permission.RECORD_AUDIO},
                        AUDIO_PERMISSION_REQUEST
                );
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
        webView.postDelayed(() -> {
            String current = webView.getUrl();
            if (current == null || current.isEmpty() || "about:blank".equals(current)) {
                Log.i("NianNianWeb", "startup navigation retry");
                loadScoreBoost();
            }
        }, 1200);
    }

    private void loadScoreBoost() {
        webView.loadUrl(scoreBoostUrl(normalizeUrl(BuildConfig.DEFAULT_SERVER_URL)));
    }

    private void notifyNativeAudioPermission(boolean granted) {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('niannian-native-audio-permission',{detail:{granted:"
                        + granted + "}}));",
                null
        ));
    }

    private void emitNativeAudio(byte[] bytes, int count) {
        if (webView == null || count <= 0) return;
        long squareSum = 0;
        for (int index = 0; index + 1 < count; index += 2) {
            int sample = (short) ((bytes[index] & 0xff) | (bytes[index + 1] << 8));
            squareSum += (long) sample * sample;
        }
        double rms = Math.sqrt(squareSum / Math.max(1, count / 2.0)) / 32768.0;
        String audio = Base64.encodeToString(bytes, 0, count, Base64.NO_WRAP);
        String script = "window.dispatchEvent(new CustomEvent('niannian-native-audio',{detail:{audio:'"
                + audio + "',level:" + Math.min(1.0, rms * 6.0) + "}}));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private String startNativeCapture() {
        synchronized (audioCaptureLock) {
            if (audioCaptureThread != null && audioCaptureThread.isAlive()) {
                Log.i("NianNianAudio", "native capture already running");
                return "started";
            }
            nativeMicrophoneMuted = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(
                        new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST
                ));
                Log.i("NianNianAudio", "requesting RECORD_AUDIO permission");
                return "permission_requested";
            }
            int sampleRate = 16_000;
            int minimumBuffer = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            if (minimumBuffer <= 0) {
                Log.e("NianNianAudio", "AudioRecord has no usable buffer");
                return "unavailable";
            }
            try {
                AudioRecord record = new AudioRecord(
                        MediaRecorder.AudioSource.VOICE_RECOGNITION,
                        sampleRate,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        Math.max(minimumBuffer * 2, 4096)
                );
                if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                    record.release();
                    Log.e("NianNianAudio", "AudioRecord is not initialized");
                    return "unavailable";
                }
                audioRecord = record;
                Thread thread = new Thread(() -> {
                    byte[] buffer = new byte[2048];
                    try {
                        record.startRecording();
                        while (!Thread.currentThread().isInterrupted() && audioRecord == record) {
                            int read = record.read(buffer, 0, buffer.length);
                            if (read > 0 && !nativeMicrophoneMuted) emitNativeAudio(buffer, read);
                        }
                    } catch (IllegalStateException ignored) {
                        // The bridge reports an unavailable source through its start result.
                    } finally {
                        try { record.stop(); } catch (IllegalStateException ignored) { }
                        record.release();
                        if (audioRecord == record) audioRecord = null;
                    }
                }, "niannian-native-audio");
                audioCaptureThread = thread;
                thread.start();
                Log.i("NianNianAudio", "native capture started");
                return "started";
            } catch (SecurityException error) {
                Log.e("NianNianAudio", "native capture permission denied", error);
                return "permission_denied";
            } catch (RuntimeException error) {
                Log.e("NianNianAudio", "native capture unavailable", error);
                return "unavailable";
            }
        }
    }

    private void stopNativeCapture() {
        synchronized (audioCaptureLock) {
            Thread thread = audioCaptureThread;
            audioCaptureThread = null;
            AudioRecord record = audioRecord;
            audioRecord = null;
            if (thread != null) thread.interrupt();
            if (record != null) {
                try { record.stop(); } catch (IllegalStateException ignored) { }
            }
        }
    }

    private final class NativeAudioBridge {
        @JavascriptInterface
        public String startCapture() {
            return startNativeCapture();
        }

        @JavascriptInterface
        public void stopCapture() {
            stopNativeCapture();
        }

        @JavascriptInterface
        public void setMuted(boolean muted) {
            nativeMicrophoneMuted = muted;
        }

        @JavascriptInterface
        public void reportStatus(String status) {
            Log.i("NianNianAudio", "web status=" + status);
        }
    }

    private String scoreBoostUrl(String baseUrl) {
        return baseUrl + "/space/score/photo";
    }

    private String normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        return value;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != AUDIO_PERMISSION_REQUEST || pendingAudioRequest == null) return;
        PermissionRequest request = pendingAudioRequest;
        pendingAudioRequest = null;
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        notifyNativeAudioPermission(granted);
        if (granted) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else {
            request.deny();
            Toast.makeText(this, "未获得麦克风权限，您可以拍题或使用文字作答。", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        stopNativeCapture();
        super.onDestroy();
    }

}
