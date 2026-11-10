package com.baraton.attendsmart.lecturer.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * The class register, owned by the lecturer's phone.
 *
 * One document, exactly the shape the web client renders from: halls,
 * lecturers, students, courses (with their rosters), sessions, attendance,
 * identity locks and security events. Every mutation happens inside
 * {@link #lock()} so two students posting in the same second cannot interleave,
 * and the whole document is flushed to private storage a couple of seconds
 * after the last change instead of once per check-in.
 */
public final class Register {

    public static final String FILE_NAME = "class-register.json";

    private final JsonObject doc = new JsonObject();
    private final File file;
    private final Object lock = new Object();
    /** Monitor SSE readers wait on; notified after every committed change. */
    private final Object change = new Object();

    private volatile boolean dirty;
    private volatile boolean closed;
    /** Serialized snapshot; rebuilt only when a change invalidates it. */
    private volatile String stateCache;
    private ScheduledExecutorService saver;
    private String seedJson;

    private Register(File file) {
        this.file = file;
    }

    /**
     * Load the register: the seeded semester from the APK, replaced by the
     * saved document when the phone has already hosted a class.
     */
    public static Register bootstrap(String seedJson, File directory) throws IOException {
        Register register = new Register(new File(directory, FILE_NAME));
        register.seedJson = seedJson;
        JsonObject seed = seedDocument(seedJson);
        replace(register.doc, seed);

        if (register.file.isFile()) {
            try {
                String saved = readFile(register.file);
                JsonObject parsed = JsonParser.parseString(saved).getAsJsonObject();
                if (parsed.has("revision")) replace(register.doc, parsed);
            } catch (RuntimeException | IOException corrupt) {
                // A half-written file must never stop the class: fall back to the seed.
                register.dirty = true;
            }
        }
        return register;
    }

    public Object lock() {
        return lock;
    }

    public Object changeSignal() {
        return change;
    }

    public JsonObject doc() {
        return doc;
    }

    public JsonArray array(String name) {
        JsonElement value = doc.get(name);
        if (value == null || !value.isJsonArray()) {
            JsonArray created = new JsonArray();
            doc.add(name, created);
            return created;
        }
        return value.getAsJsonArray();
    }

    public int revision() {
        JsonElement value = doc.get("revision");
        return value == null || value.isJsonNull() ? 0 : value.getAsInt();
    }

    /** Increment the revision, mark the document dirty and wake live readers. */
    public int bump() {
        int next = revision() + 1;
        doc.addProperty("revision", next);
        stateCache = null;
        markDirty();
        return next;
    }

    /**
     * The snapshot the app renders from, serialized once per revision. Without
     * this every phone in the room would re-serialize 1.2 MB on each poll.
     */
    public String stateJson() {
        String cached = stateCache;
        if (cached != null) return cached;
        synchronized (lock) {
            if (stateCache == null) stateCache = doc.toString();
            return stateCache;
        }
    }

    public void markDirty() {
        dirty = true;
        synchronized (change) {
            change.notifyAll();
        }
    }

    /** Wake SSE readers without changing anything (used for keep-alive frames). */
    public void wakeReaders() {
        synchronized (change) {
            change.notifyAll();
        }
    }

    /** Restore the seeded semester, as the laptop server's reset does. */
    public void resetToSeed() {
        JsonObject seed = seedDocument(seedJson);
        replace(doc, seed);
        doc.addProperty("revision", 1);
        markDirty();
        flush();
    }

    public void startSaver() {
        if (saver != null) return;
        saver = Executors.newSingleThreadScheduledExecutor();
        saver.scheduleWithFixedDelay(() -> {
            try {
                flush();
            } catch (RuntimeException ignored) {
                // Retried on the next tick; the in-memory register stays authoritative.
            }
        }, 2, 2, TimeUnit.SECONDS);
    }

    /** Write the document when it changed. Atomic: temp file then rename. */
    public void flush() {
        if (!dirty || closed || file == null) return;
        dirty = false;
        String json;
        synchronized (lock) {
            json = doc.toString();
        }
        try {
            File temp = new File(file.getParentFile(), FILE_NAME + ".tmp");
            try (FileOutputStream out = new FileOutputStream(temp)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            }
            try {
                Files.move(temp.toPath(), file.toPath(),
                        StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException atomicUnsupported) {
                Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException err) {
            dirty = true;
        }
    }

    public void stop() {
        if (saver != null) {
            saver.shutdownNow();
            saver = null;
        }
        dirty = true;
        flush();
        wakeReaders();
    }

    /* ---------------------------------------------------------------- */

    /**
     * The APK ships the snapshot exactly as /api/state returns it, so accept
     * both { ok, state: {...} } and a bare register document.
     */
    private static JsonObject seedDocument(String json) {
        JsonObject parsed = JsonParser.parseString(json).getAsJsonObject();
        JsonElement state = parsed.get("state");
        if (state != null && state.isJsonObject() && !parsed.has("sessions")) {
            return state.getAsJsonObject();
        }
        return parsed;
    }

    private static void replace(JsonObject target, JsonObject source) {
        for (String key : new java.util.ArrayList<>(target.keySet())) target.remove(key);
        for (String key : source.keySet()) target.add(key, source.get(key));
    }

    private static String readFile(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
