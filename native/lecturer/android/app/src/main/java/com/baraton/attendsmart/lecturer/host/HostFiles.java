package com.baraton.attendsmart.lecturer.host;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Writes an export somewhere the user can find it.
 *
 * A WebView has no download manager: an <a download> click on a blob: URL does
 * nothing at all inside the APK, so the DOWNLOAD EXCEL button looked broken
 * while the browser build worked. This puts the file in Downloads/CLASSPREF3CT
 * through MediaStore on Android 10+, and in the app's own Downloads folder on
 * older phones, then tells the page where it landed.
 */
final class HostFiles {

    private static final String FOLDER = "CLASSPREF3CT";

    private HostFiles() {
    }

    static void saveText(Context context, PluginCall call) {
        String name = clean(call.getString("name", "attendease.csv"));
        String mime = call.getString("mime", "text/csv");
        String content = call.getString("content", "");
        if (content == null) content = "";

        try {
            String shown;
            String uri;

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);

                Uri target = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (target == null) throw new IOException("Android refused to create a file in Downloads.");

                OutputStream opened = context.getContentResolver().openOutputStream(target);
                if (opened == null) throw new IOException("Android refused to open the new file.");
                try (OutputStream stream = opened) {
                    stream.write(content.getBytes(StandardCharsets.UTF_8));
                }
                uri = target.toString();
                shown = "Downloads/" + FOLDER + "/" + name;
            } else {
                File dir = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Could not create the export folder.");
                File file = new File(dir, name);
                try (FileOutputStream stream = new FileOutputStream(file)) {
                    stream.write(content.getBytes(StandardCharsets.UTF_8));
                }
                uri = Uri.fromFile(file).toString();
                shown = file.getAbsolutePath();
            }

            JSObject payload = new JSObject();
            payload.put("path", shown);
            payload.put("uri", uri);
            payload.put("name", name);
            call.resolve(payload);
        } catch (IOException | RuntimeException err) {
            String reason = err.getMessage() == null ? "unknown error" : err.getMessage();
            call.reject("Could not save " + name + ": " + reason);
        }
    }

    /** Keep the file name boring: no slashes, no surprises. */
    private static String clean(String name) {
        String safe = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "-");
        if (safe.isEmpty()) safe = "attendease.csv";
        return safe.length() > 80 ? safe.substring(safe.length() - 80) : safe;
    }
}
