package com.baraton.attendsmart.lecturer.host;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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
 * Starts and stops the class register inside the lecturer app.
 *
 * The seed register ships in the APK; the first run copies it into private
 * storage, and every later run resumes the saved register. Two doors lead to
 * it: an HTTP port on the LAN, and a Bluetooth service for phones whose Wi-Fi
 * cannot reach another client. Both answer the same routes.
 */
@CapacitorPlugin(name = "ClassHost", permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
})
public class ClassHostPlugin extends Plugin {

    private static final String SEED_ASSET = "host-seed.json";

    private Register register;
    private ClassServer server;
    private Discovery discovery;
    private BtServer bluetooth;
    private String bluetoothError;

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

            openBluetooth();

            call.resolve(statusPayload());
        } catch (IOException err) {
            call.reject("Could not start the class server: " + err.getMessage());
        } catch (RuntimeException err) {
            call.reject("Could not start the class server: " + err.getMessage());
        }
    }

    /** Turn the Bluetooth door on from the host card, asking for permission once. */
    @PluginMethod
    public void enableBluetooth(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "afterBluetoothPermission");
            return;
        }
        openBluetooth();
        call.resolve(statusPayload());
    }

    @PermissionCallback
    private void afterBluetoothPermission(PluginCall call) {
        openBluetooth();
        call.resolve(statusPayload());
    }

    /**
     * Ask Android to show this phone to strangers for five minutes. Pairing is
     * the only way Bluetooth lets two phones talk, so a class of new students
     * needs this window (or a lecturer who leaves it on).
     */
    @PluginMethod
    public void discoverable(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("This phone has no Bluetooth radio.");
            return;
        }
        try {
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth is switched off on this phone.");
                return;
            }
        } catch (SecurityException denied) {
            call.reject("Android has not allowed this app to use Bluetooth.");
            return;
        }

        Intent intent = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
        intent.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
        startActivityForResult(call, intent, "afterDiscoverable");
    }

    @ActivityCallback
    private void afterDiscoverable(PluginCall call, ActivityResult result) {
        if (call == null) return;
        int seconds = result == null ? 0 : result.getResultCode();
        JSObject payload = statusPayload();
        payload.put("findable", seconds > 0);
        payload.put("seconds", Math.max(0, seconds));
        call.resolve(payload);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            stopEverything();
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

    /**
     * Save an export where the user can actually find it. The WebView cannot
     * download, so the CSV that DOWNLOAD EXCEL builds arrives here instead.
     */
    @PluginMethod
    public void saveText(PluginCall call) {
        HostFiles.saveText(getContext(), call);
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
        stopEverything();
        super.handleOnDestroy();
    }

    private void stopEverything() {
        if (bluetooth != null) {
            bluetooth.stop();
            bluetooth = null;
        }
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
    }

    /** Bluetooth is a second door, never a gate: a failure leaves Wi-Fi working. */
    private void openBluetooth() {
        if (server == null || !server.isRunning()) return;
        if (bluetooth != null && bluetooth.isRunning()) {
            bluetoothError = null;
            return;
        }
        try {
            bluetooth = new BtServer(server);
            bluetooth.start();
            bluetoothError = null;
        } catch (IOException err) {
            bluetooth = null;
            bluetoothError = err.getMessage();
        } catch (RuntimeException err) {
            bluetooth = null;
            bluetoothError = err.getMessage();
        }
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

        boolean btOn = bluetooth != null && bluetooth.isRunning();
        payload.put("bluetooth", btOn);
        payload.put("bluetoothName", btOn ? bluetooth.deviceName() : null);
        payload.put("bluetoothStudents", btOn ? bluetooth.students() : 0);
        payload.put("bluetoothError", bluetoothError);
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
