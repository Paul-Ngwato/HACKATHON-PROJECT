package com.baraton.attendsmart.lecturer.host;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPOutputStream;

/**
 * The class server that runs inside the lecturer's app.
 *
 * Same routes, same response shapes as the laptop server, so the web client is
 * unchanged. Students on the same Wi-Fi reach it at http://&lt;phone-ip&gt;:4173
 * and the lecturer's own WebView uses http://127.0.0.1:4173.
 *
 * One request per connection with Connection: close keeps this small enough to
 * trust without an HTTP library; the live stream stays open and is flushed on
 * every frame, which a buffering implementation would break.
 */
public final class ClassServer {

    public static final int DEFAULT_PORT = 4173;
    public static final int PORT = DEFAULT_PORT;

    private static final int MAX_BODY = 2 * 1024 * 1024;
    private static final String JSON = "application/json; charset=utf-8";

    private final Register register;
    private final int port;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final AtomicInteger streamClients = new AtomicInteger();

    private volatile boolean running;
    private ServerSocket serverSocket;
    private Thread acceptor;

    public ClassServer(Register register, int port) {
        this.register = register;
        this.port = port;
    }

    public int port() {
        return port;
    }

    public boolean isRunning() {
        return running;
    }

    public int streamClients() {
        return streamClients.get();
    }

    public void start() throws IOException {
        if (running) return;
        serverSocket = new ServerSocket(port, 64);
        serverSocket.setReuseAddress(true);
        running = true;
        acceptor = new Thread(this::acceptLoop, "attendease-accept");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    public void stop() {
        running = false;
        register.wakeReaders();
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // already closed
            }
            serverSocket = null;
        }
        workers.shutdownNow();
    }

    /* ------------------------------------------------------------------ */
    /* Accept loop                                                         */
    /* ------------------------------------------------------------------ */

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = serverSocket.accept();
                workers.execute(() -> handle(client));
            } catch (IOException stopped) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket client) {
        try (Socket socket = client) {
            socket.setSoTimeout(20000);
            socket.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(socket.getInputStream(), 8192);
            OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 16384);
            serveOne(in, out, true);
        } catch (IOException | RuntimeException dropped) {
            // A student walking out of range must never stop the class.
        }
    }

    /**
     * Answer exactly one request read from {@code in}.
     *
     * The Wi-Fi socket and the Bluetooth socket both end up here, so a student
     * on either transport gets the same routes and the same rules. Bluetooth
     * cannot carry the live event stream, so that one route is refused there.
     *
     * Returns false when the peer closed without sending anything, which is how
     * the Bluetooth loop knows to let go of the socket.
     */
    boolean serveOne(InputStream in, OutputStream out, boolean allowEvents) throws IOException {
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return false;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return false;
            String method = parts[0].toUpperCase(Locale.US);
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    headers.put(line.substring(0, colon).trim().toLowerCase(Locale.US), line.substring(colon + 1).trim());
                }
            }

            String body = "";
            String declared = headers.get("content-length");
            if (declared != null) {
                try {
                    int size = Integer.parseInt(declared.trim());
                    if (size > 0 && size <= MAX_BODY) {
                        byte[] buffer = new byte[size];
                        int read = 0;
                        while (read < size) {
                            int chunk = in.read(buffer, read, size - read);
                            if (chunk < 0) break;
                            read += chunk;
                        }
                        body = new String(buffer, 0, read, StandardCharsets.UTF_8);
                    }
                } catch (NumberFormatException ignored) {
                    // an unparseable length means an empty body
                }
            }

            String path = target;
            String queryString = "";
            int mark = target.indexOf('?');
            if (mark >= 0) {
                path = target.substring(0, mark);
                queryString = target.substring(mark + 1);
            }
            boolean gzip = headers.getOrDefault("accept-encoding", "").toLowerCase(Locale.US).contains("gzip");

            if ("OPTIONS".equals(method)) {
                send(out, 204, null, new byte[0], false);
                return true;
            }
            if ("/api/events".equals(path) || "/api/events/".equals(path)) {
                if (!allowEvents) {
                    send(out, 404, JSON, "{\"ok\":false,\"error\":\"Live updates are not available over Bluetooth.\"}"
                            .getBytes(StandardCharsets.UTF_8), false);
                    return true;
                }
                serveEvents(out);
                return true;
            }

            route(method, path, parseQuery(queryString), body, out, gzip);
            out.flush();
            return true;
    }

    /* ------------------------------------------------------------------ */
    /* Routes                                                              */
    /* ------------------------------------------------------------------ */

    private void route(String method, String path, Map<String, String> query, String body,
                       OutputStream out, boolean gzip) throws IOException {
        boolean get = "GET".equals(method);
        boolean post = "POST".equals(method);

        try {
            if (get && ("/api/state".equals(path) || "/".equals(path))) {
                String payload;
                synchronized (register.lock()) {
                    payload = "/".equals(path)
                            ? "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                            + "<body style=\"font-family:system-ui;background:#F4F1E4;color:#123;padding:24px\">"
                            + "<h2 style=\"color:#0B5D2E;margin:0 0 6px\">AttendEase class register</h2>"
                            + "<p>This phone is hosting the attendance register.</p><p>Revision "
                            + register.revision() + "</p></body>"
                            : "{\"ok\":true,\"state\":" + register.stateJson() + "}";
                }
                send(out, 200, "/".equals(path) ? "text/html; charset=utf-8" : JSON,
                        payload.getBytes(StandardCharsets.UTF_8), gzip);
                return;
            }

            if (get && "/api/health".equals(path)) {
                JsonObject health = new JsonObject();
                health.addProperty("ok", true);
                health.addProperty("revision", register.revision());
                health.addProperty("time", Rules.nowIso());
                health.addProperty("database", Register.FILE_NAME);
                String lan = Discovery.lanIp();
                if (lan != null) health.addProperty("lan", "http://" + lan + ":" + port);
                send(out, 200, JSON, health.toString().getBytes(StandardCharsets.UTF_8), gzip);
                return;
            }

            if (get && "/api/sessions/lookup".equals(path)) {
                String payload;
                synchronized (register.lock()) {
                    JsonObject result = Rules.lookupSession(register, query.get("code"), query.get("studentId"));
                    payload = "{\"ok\":true,\"result\":" + result + "}";
                }
                send(out, 200, JSON, payload.getBytes(StandardCharsets.UTF_8), gzip);
                return;
            }

            if (post && "/api/checkin".equals(path)) {
                JsonObject payload = parse(body);
                String outJson;
                synchronized (register.lock()) {
                    JsonObject result = Rules.checkIn(register,
                            text(payload, "code"),
                            text(payload, "studentId"),
                            text(payload, "deviceId"),
                            number(payload, "lat"),
                            number(payload, "lng"),
                            number(payload, "accuracy"),
                            text(payload, "method"));
                    // Deliberately no snapshot: 85 students posting must not each
                    // pull 1.2 MB back down the Wi-Fi.
                    outJson = "{\"ok\":true,\"result\":" + result + ",\"revision\":" + register.revision() + "}";
                }
                send(out, 200, JSON, outJson.getBytes(StandardCharsets.UTF_8), gzip);
                return;
            }

            if (post && "/api/anchor".equals(path)) {
                String outJson;
                synchronized (register.lock()) {
                    JsonObject anchor = new JsonObject();
                    anchor.addProperty("ok", true);
                    anchor.addProperty("revision", register.revision());
                    anchor.addProperty("clients", streamClients.get());
                    anchor.addProperty("time", Rules.nowIso());
                    outJson = anchor.toString();
                }
                send(out, 200, JSON, outJson.getBytes(StandardCharsets.UTF_8), gzip);
                return;
            }

            if (post) {
                JsonObject payload = parse(body);
                String outJson;
                synchronized (register.lock()) {
                    JsonObject result = mutate(path, payload);
                    outJson = "{\"ok\":true,\"result\":" + result + ",\"state\":" + register.stateJson() + "}";
                }
                send(out, 200, JSON, outJson.getBytes(StandardCharsets.UTF_8), gzip);
                return;
            }

            send(out, 404, JSON, "{\"ok\":false,\"error\":\"Unknown route.\"}".getBytes(StandardCharsets.UTF_8), gzip);
        } catch (Rules.ApiError refused) {
            sendError(out, refused.status, refused.getMessage(), gzip);
        } catch (RuntimeException malformed) {
            sendError(out, 500, "The class register could not complete that request.", gzip);
        }
    }

    /** All POST mutations except check-in. Caller holds the register lock. */
    private JsonObject mutate(String path, JsonObject payload) throws Rules.ApiError {
        String actorId = text(payload, "actorId");
        String courseId = text(payload, "courseId");
        String sessionId = text(payload, "sessionId");

        switch (path) {
            case "/api/sessions/start":
                return Rules.startSession(register, courseId, actorId,
                        number(payload, "durationMin") == null ? null : (int) Math.round(number(payload, "durationMin")),
                        number(payload, "lat"), number(payload, "lng"),
                        number(payload, "accuracy"), number(payload, "radius"));
            case "/api/sessions/end":
                return Rules.endSession(register, sessionId, actorId);
            case "/api/sessions/rotate":
                return Rules.rotateCode(register, sessionId, actorId);
            case "/api/courses/create":
                return Rules.createCourse(register, payload, actorId);
            case "/api/courses/setup":
                return Rules.updateCourseSetup(register, courseId, object(payload, "patch"), actorId);
            case "/api/courses/roster": {
                JsonElement ids = payload.get("studentIds");
                return Rules.setCourseRoster(register, courseId,
                        ids != null && ids.isJsonArray() ? ids.getAsJsonArray() : null, actorId);
            }
            case "/api/courses/finalize":
                return Rules.finalizeCourseRoster(register, courseId, actorId);
            case "/api/courses/import": {
                JsonElement entries = payload.get("entries");
                return Rules.importRoster(register, courseId,
                        entries != null && entries.isJsonArray() ? entries.getAsJsonArray() : null, actorId);
            }
            case "/api/courses/venue":
                return Rules.setCourseVenue(register, courseId,
                        number(payload, "lat"), number(payload, "lng"),
                        number(payload, "accuracy"), number(payload, "radius"), actorId);
            case "/api/admin/reset":
                return Rules.reset(register);
            default:
                throw new Rules.ApiError(404, "Unknown route.");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Live events                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Server-sent events: one frame per revision, plus a keep-alive so a phone
     * that went to sleep is detected and its socket released.
     */
    private void serveEvents(OutputStream out) throws IOException {
        streamClients.incrementAndGet();
        try {
            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 200 OK\r\n");
            head.append("Content-Type: text/event-stream; charset=utf-8\r\n");
            head.append("Connection: close\r\n");
            head.append("Access-Control-Allow-Origin: *\r\n");
            head.append("Cache-Control: no-store\r\n");
            head.append("\r\n");
            out.write(head.toString().getBytes(StandardCharsets.UTF_8));
            out.write("retry: 2000\n\n".getBytes(StandardCharsets.UTF_8));
            out.flush();

            int lastSent = -1;
            while (running) {
                int revision = register.revision();
                if (revision != lastSent) {
                    lastSent = revision;
                    out.write(("event: state\ndata: {\"revision\":" + revision + "}\n\n")
                            .getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    continue;
                }
                Object signal = register.changeSignal();
                synchronized (signal) {
                    try {
                        signal.wait(20000);
                    } catch (InterruptedException stop) {
                        return;
                    }
                }
                if (register.revision() == lastSent) {
                    out.write(": keep-alive\n\n".getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
            }
        } finally {
            streamClients.decrementAndGet();
        }
    }

    /* ------------------------------------------------------------------ */
    /* HTTP plumbing                                                       */
    /* ------------------------------------------------------------------ */

    private void sendError(OutputStream out, int status, String message, boolean gzip) throws IOException {
        JsonObject error = new JsonObject();
        error.addProperty("ok", false);
        error.addProperty("error", message == null ? "Request failed." : message);
        send(out, status, JSON, error.toString().getBytes(StandardCharsets.UTF_8), gzip);
    }

    private void send(OutputStream out, int status, String contentType, byte[] body, boolean gzip) throws IOException {
        byte[] payload = body;
        boolean compressed = false;
        if (gzip && body.length > 1024) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(Math.max(64, body.length / 4));
            try (GZIPOutputStream zip = new GZIPOutputStream(buffer)) {
                zip.write(body);
            }
            payload = buffer.toByteArray();
            compressed = true;
        }

        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(statusText(status)).append("\r\n");
        if (contentType != null) head.append("Content-Type: ").append(contentType).append("\r\n");
        head.append("Content-Length: ").append(payload.length).append("\r\n");
        head.append("Connection: close\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        head.append("Access-Control-Allow-Headers: Content-Type\r\n");
        head.append("Access-Control-Max-Age: 86400\r\n");
        head.append("Cache-Control: no-store\r\n");
        if (compressed) head.append("Content-Encoding: gzip\r\n");
        head.append("\r\n");

        out.write(head.toString().getBytes(StandardCharsets.UTF_8));
        if (payload.length > 0) out.write(payload);
        out.flush();
    }

    private static String statusText(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 409: return "Conflict";
            case 500: return "Internal Server Error";
            case 503: return "Service Unavailable";
            default: return "OK";
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(128);
        int value;
        boolean any = false;
        while ((value = in.read()) >= 0) {
            any = true;
            if (value == '\n') break;
            if (value != '\r') buffer.write(value);
            if (buffer.size() > 8192) break;
        }
        if (!any && buffer.size() == 0) return null;
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> params = new HashMap<>();
        if (query == null || query.isEmpty()) return params;
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) continue;
            int equals = pair.indexOf('=');
            try {
                String key = equals < 0 ? pair : pair.substring(0, equals);
                String value = equals < 0 ? "" : pair.substring(equals + 1);
                params.put(URLDecoder.decode(key, "UTF-8"), URLDecoder.decode(value, "UTF-8"));
            } catch (Exception ignored) {
                // skip an undecodable pair
            }
        }
        return params;
    }

    private static JsonObject parse(String body) {
        if (body == null || body.trim().isEmpty()) return new JsonObject();
        JsonElement parsed = JsonParser.parseString(body);
        return parsed.isJsonObject() ? parsed.getAsJsonObject() : new JsonObject();
    }

    static String text(JsonObject object, String key) {
        if (object == null) return null;
        JsonElement value = object.get(key);
        if (value == null || value.isJsonNull()) return null;
        try {
            return value.getAsString();
        } catch (RuntimeException notPrimitive) {
            return null;
        }
    }

    static Double number(JsonObject object, String key) {
        if (object == null) return null;
        JsonElement value = object.get(key);
        if (value == null || value.isJsonNull()) return null;
        try {
            return value.getAsDouble();
        } catch (RuntimeException notNumber) {
            return null;
        }
    }

    static JsonObject object(JsonObject object, String key) {
        JsonElement value = object == null ? null : object.get(key);
        return value != null && value.isJsonObject() ? value.getAsJsonObject() : new JsonObject();
    }
}
