package net.schembench;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Schem Bench for Android.
 *
 * The tool itself is the same web app that lives in app/; this is the shell
 * that gives it the two things a browser tab cannot do on a phone: reach the
 * file the user picks, and write a .mcstructure back out where they can find
 * it.
 *
 * Assets are served over a virtual https origin rather than file:// because
 * ES modules are blocked by CORS on file://, and because a secure origin is
 * what the rest of the web platform expects. Nothing actually leaves the
 * device - shouldInterceptRequest answers every request out of assets/, and
 * the app holds no INTERNET permission at all.
 */
public class MainActivity extends Activity {

  private static final String HOST = "schembench.local";
  private static final String ORIGIN = "https://" + HOST + "/";
  private static final String ASSET_ROOT = "www";

  private static final int REQ_PICK = 1001;
  private static final int REQ_CREATE = 1002;

  private WebView web;
  private ValueCallback<Uri[]> pendingPick;

  /** Bytes waiting on a Storage Access Framework save (API < 29 path). */
  byte[] pendingSave;
  String pendingSaveName;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);

    web = new WebView(this);
    setContentView(web, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setCacheMode(WebSettings.LOAD_NO_CACHE);

    web.setWebViewClient(new AssetClient());
    web.setWebChromeClient(new Chrome());
    web.addJavascriptInterface(new Bridge(this), "SchemBench");

    if (state != null) web.restoreState(state);
    else web.loadUrl(ORIGIN);
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }

  @Override
  public boolean onKeyDown(int code, KeyEvent event) {
    if (code == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
      web.goBack();
      return true;
    }
    return super.onKeyDown(code, event);
  }

  /* ---------------------------------------------------------------- *
   * Serving the app out of assets/
   * ---------------------------------------------------------------- */

  private class AssetClient extends WebViewClient {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      Uri url = request.getUrl();
      if (url == null || !HOST.equals(url.getHost())) return null;

      String path = url.getPath();
      if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";

      String asset = ASSET_ROOT + path;
      try {
        InputStream in = getAssets().open(asset);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mimeFor(asset), null, 200, "OK", headers, in);
      } catch (IOException missing) {
        byte[] body = ("Not found: " + path).getBytes();
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
            null, new ByteArrayInputStream(body));
      }
    }
  }

  /**
   * A module script served with the wrong type is silently refused, so these
   * have to be right rather than close.
   */
  private static String mimeFor(String path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".js")) return "text/javascript";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".webmanifest")) return "application/manifest+json";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".woff2")) return "font/woff2";
    return "application/octet-stream";
  }

  /* ---------------------------------------------------------------- *
   * Picking a world
   * ---------------------------------------------------------------- */

  private class Chrome extends WebChromeClient {
    @Override
    public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                     FileChooserParams params) {
      if (pendingPick != null) pendingPick.onReceiveValue(null);
      pendingPick = callback;

      // Every Minecraft container is a zip under a custom extension, and
      // Android's picker greys out anything it cannot name a MIME type for.
      // Asking for */* keeps .mcworld and .mctemplate selectable; the page
      // identifies the real format from the file's own bytes.
      Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      pick.addCategory(Intent.CATEGORY_OPENABLE);
      pick.setType("*/*");
      try {
        startActivityForResult(Intent.createChooser(pick, "Open a world"), REQ_PICK);
        return true;
      } catch (Exception e) {
        pendingPick = null;
        toast("No file manager available.");
        return false;
      }
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    if (request == REQ_PICK) {
      if (pendingPick == null) return;
      Uri[] picked = null;
      if (result == RESULT_OK && data != null && data.getData() != null) {
        picked = new Uri[]{data.getData()};
      }
      pendingPick.onReceiveValue(picked);
      pendingPick = null;
      return;
    }

    if (request == REQ_CREATE) {
      byte[] bytes = pendingSave;
      pendingSave = null;
      String name = pendingSaveName;
      pendingSaveName = null;

      if (result != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
      try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
        out.write(bytes);
        toast("Saved " + name);
      } catch (Exception e) {
        toast("Could not save: " + e.getMessage());
      }
      return;
    }

    super.onActivityResult(request, result, data);
  }

  /* ---------------------------------------------------------------- *
   * Saving a structure
   * ---------------------------------------------------------------- */

  /**
   * Static on purpose: a non-static inner class would pin the activity for as
   * long as the WebView holds the bridge, and d8 8.2.2 also mishandles
   * @JavascriptInterface on a private inner class's synthetic constructor.
   */
  public static class Bridge {
    private final MainActivity host;

    Bridge(MainActivity host) {
      this.host = host;
    }

    /**
     * Called from the page with the finished .mcstructure. Runs on a binder
     * thread, so anything touching the UI is posted back.
     *
     * @return true once the bytes are written, or once a save dialog is up
     */
    @JavascriptInterface
    public boolean saveFile(String name, String base64) {
      byte[] bytes;
      try {
        bytes = Base64.decode(base64, Base64.DEFAULT);
      } catch (IllegalArgumentException bad) {
        host.toast("The file data was malformed.");
        return false;
      }
      if (bytes.length == 0) return false;

      final String safe =
          name == null || name.trim().isEmpty() ? "structure.mcstructure" : name.trim();

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        return host.saveToDownloads(safe, bytes);
      }
      // Older releases have no scoped Downloads collection; let the user place
      // it instead of asking for a storage permission we would rather not hold.
      host.pendingSave = bytes;
      host.pendingSaveName = safe;
      host.runOnUiThread(new Runnable() {
        @Override
        public void run() {
          Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
          create.addCategory(Intent.CATEGORY_OPENABLE);
          create.setType("application/octet-stream");
          create.putExtra(Intent.EXTRA_TITLE, safe);
          host.startActivityForResult(create, REQ_CREATE);
        }
      });
      return true;
    }

    @JavascriptInterface
    public String platform() {
      return "android-" + Build.VERSION.SDK_INT;
    }
  }

  /** Writes straight into the shared Downloads collection. No permission needed. */
  boolean saveToDownloads(String name, byte[] bytes) {
    ContentValues values = new ContentValues();
    values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

    Uri target = null;
    try {
      target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
      if (target == null) return false;
      try (OutputStream out = getContentResolver().openOutputStream(target)) {
        out.write(bytes);
      }
      toast("Saved to Downloads: " + name);
      return true;
    } catch (Exception e) {
      if (target != null) getContentResolver().delete(target, null, null);
      toast("Could not save: " + e.getMessage());
      return false;
    }
  }

  void toast(final String message) {
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
      }
    });
  }
}
