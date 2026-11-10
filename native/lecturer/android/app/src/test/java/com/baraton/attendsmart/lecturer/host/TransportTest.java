package com.baraton.attendsmart.lecturer.host;

import org.junit.Before;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Bluetooth carries the register over a socket that stays open, so the routes
 * have to answer more than one request per stream. These tests drive the real
 * routing through plain byte streams — the same path both transports use —
 * without a radio or a network.
 */
public class TransportTest {

    private ClassServer server;

    @Before
    public void setUp() throws Exception {
        Path seedPath = Paths.get("src/main/assets/host-seed.json");
        String seed = new String(Files.readAllBytes(seedPath), StandardCharsets.UTF_8);
        File dir = Files.createTempDirectory("attendance-transport").toFile();
        Register register = Register.bootstrap(seed, dir);
        server = new ClassServer(register, 4173);
    }

    @Test
    public void answersAHealthCheckOverAnyStream() throws Exception {
        String response = exchange(request("GET", "/api/health"));
        assertTrue(response.startsWith("HTTP/1.1 200"));
        assertTrue(response.contains("\"ok\":true"));
        assertTrue(response.contains("\"revision\""));
    }

    @Test
    public void sendsTheWholeRegister() throws Exception {
        String response = exchange(request("GET", "/api/state"));
        assertTrue(response.startsWith("HTTP/1.1 200"));
        assertTrue(response.contains("\"state\""));
        assertTrue(response.contains("\"courses\""));
    }

    @Test
    public void leavesTheBodyUncompressedWhenAsked() throws Exception {
        String response = exchange(request("GET", "/api/state", null, "identity"));
        assertFalse("the reader parses the bytes itself", response.contains("Content-Encoding: gzip"));
        assertTrue(response.contains("\"courses\""));
    }

    @Test
    public void refusesTheLiveStreamBecauseBluetoothCannotHoldItOpen() throws Exception {
        String response = exchange(request("GET", "/api/events"));
        assertTrue(response.startsWith("HTTP/1.1 404"));
        assertTrue(response.contains("Bluetooth"));
    }

    /** The property the Bluetooth server depends on: one stream, many requests. */
    @Test
    public void servesSeveralRequestsOnOneOpenStream() throws Exception {
        String both = request("GET", "/api/health") + request("GET", "/api/state");
        InputStream in = new ByteArrayInputStream(both.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        assertTrue(server.serveOne(in, out, false));
        assertTrue(server.serveOne(in, out, false));

        String written = out.toString("UTF-8");
        assertEquals(2, count(written, "HTTP/1.1 200"));
        assertTrue(written.contains("\"revision\""));
        assertTrue(written.contains("\"courses\""));
    }

    @Test
    public void reportsAClosedStreamInsteadOfSpinning() throws Exception {
        InputStream in = new ByteArrayInputStream(new byte[0]);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertFalse(server.serveOne(in, out, false));
        assertEquals(0, out.size());
    }

    /* ------------------------------------------------------------------ */

    private String exchange(String raw) throws Exception {
        InputStream in = new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertTrue(server.serveOne(in, out, false));
        return out.toString("UTF-8");
    }

    private static String request(String method, String path) {
        return request(method, path, null, "identity");
    }

    private static String request(String method, String path, String body, String encoding) {
        byte[] payload = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        return method + " " + path + " HTTP/1.1\r\n"
                + "Host: bluetooth\r\n"
                + "Accept-Encoding: " + encoding + "\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: " + payload.length + "\r\n\r\n"
                + (body == null ? "" : body);
    }

    private static int count(String haystack, String needle) {
        int found = 0;
        int at = haystack.indexOf(needle);
        while (at >= 0) {
            found++;
            at = haystack.indexOf(needle, at + needle.length());
        }
        return found;
    }
}
