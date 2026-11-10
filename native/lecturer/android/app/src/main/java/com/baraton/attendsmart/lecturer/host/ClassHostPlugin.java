package com.baraton.attendsmart.lecturer.host;

import android.content.Context;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;

/**
 * Starts and stops the class server inside the lecturer app.
 *
 * The seed register ships in the APK; the first run copies it into private
 * storage, and every later run resumes the saved register. The server binds
 * the LAN interface, so students reach it at http://<this-phone>:4173.
 */
@CapacitorPlugin(name = "ClassHost")
public class ClassHostPlugin extends Plugin {

    private static final String SEED_ASSET = "host-seed.json";

    private Register register;
    private ClassServer server;
    private Discovery discovery;

    @PluginMethod
    public void start(PluginCall call) {
        try {
            int port = call.getInt("port", ClassServer.DEFAULT_PORT);
            String label = call.getString("name", "AttendEase");

            if (server != null && server.isRunning()) {
                call.resolve(statusPayload());
                return;
            }

            Context context = getContext();

            if (register == null) {
                String seed = readAsset(context, SEED_ASSET);
                register = Register.bootstrap(seed, context.getFilesDir());
                register.startSaver();
            } else {
                register.startSaver();
            }

            server = new ClassServer(register, port);
            server.start();

            discovery = new Discovery(context);
            discovery.advertise(server.port(), label);

            call.resolve(statusPayload());
        } catch (IOException err) {
            call.reject("Could not start the class server: " + err.getMessage());
        } catch (RuntimeException err) {
            call.reject("Could not start the class server: " + err.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            if (discovery != null) {
                discovery.stopAdvertising();
                discovery = null;
            }
            if (server != null) {
                server.stop();
                server = null;
            }
            if (register != null) {
                register.stop();
            }
            JSObject payload = new JSObject();
            payload.put("running", false);
            call.resolve(payload);
        } catch (RuntimeException err) {
            call.reject("Could not stop the class server: " + err.getMessage());
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusPayload());
    }

    /** Every LAN address a student could type, most useful first. */
    @PluginMethod
    public void addresses(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("addresses", new JSArray(localAddresses()));
        payload.put("port", server != null && server.isRunning() ? server.port() : ClassServer.DEFAULT_PORT);
        call.resolve(payload);
    }

    @Override
    protected void handleOnDestroy() {
        if (discovery != null) {
            discovery.stopAdvertising();
            discovery = null;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        if (register != null) {
            register.stop();
        }
        super.handleOnDestroy();
    }

    private JSObject statusPayload() {
        boolean running = server != null && server.isRunning();
        int port = running ? server.port() : ClassServer.DEFAULT_PORT;

        JSObject payload = new JSObject();
        payload.put("running", running);
        payload.put("port", port);
        payload.put("url", "http://127.0.0.1:" + port);
        payload.put("addresses", new JSArray(localAddresses()));
        if (running && register != null) {
            synchronized (register.lock()) {
                payload.put("revision", register.revision());
            }
        }
        return payload;
    }

    private static String readAsset(Context context, String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(1024 * 1024);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static java.util.List<String> localAddresses() {
        java.util.List<String> found = new java.util.ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface network : Collections.list(interfaces)) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        String host = address.getHostAddress();
                        if (host != null && !found.contains(host)) found.add(host);
                    }
                }
            }
        } catch (Exception ignored) {
            // An empty list still leaves the loopback URL usable.
        }
        return found;
    }
}
