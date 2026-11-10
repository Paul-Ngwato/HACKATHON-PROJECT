package com.baraton.attendsmart.student.host;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;

/**
 * Finds the lecturer's phone and talks to it.
 *
 * Two lanes, one answer shape. Wi-Fi first, because the class is usually on
 * one network and it is the cheapest. When the network isolates clients — the
 * address is found and the socket still never opens — the search falls through
 * to Bluetooth, and every later request in the class rides that link instead.
 *
 * Returns { found, url, host, port, name, via } and never throws for "nothing
 * nearby": the student screen shows the reason and the manual field instead.
 */
@CapacitorPlugin(name = "ClassFinder", permissions = {
        @Permission(alias = "bluetooth", strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
        })
})
public class ClassFinderPlugin extends Plugin {

    private Discovery discovery;
    private BtClient bluetooth;

    @PluginMethod
    public void find(PluginCall call) {
        if (askForBluetooth(call, "afterFindPermission")) return;
        search(call);
    }

    @PermissionCallback
    private void afterFindPermission(PluginCall call) {
        search(call);
    }

    /** One request over Bluetooth, when the Wi-Fi cannot carry it. */
    @PluginMethod
    public void call(PluginCall call) {
        if (askForBluetooth(call, "afterCallPermission")) return;

        final String method = call.getString("method", "GET");
        final String path = call.getString("path", "/api/state");
        final String body = call.getString("body", null);

        getBridge().execute(() -> {
            try {
                if (call.isReleased()) return;
                if (bluetooth == null) bluetooth = new BtClient(getContext());
                BtClient.Answer answer = bluetooth.call(method, path, body);

                JSObject payload = new JSObject();
                payload.put("status", answer.status);
                payload.put("body", answer.body);
                payload.put("via", "bluetooth");
                call.resolve(payload);
            } catch (IOException err) {
                call.reject(err.getMessage() == null ? "The Bluetooth link failed." : err.getMessage());
            } catch (RuntimeException err) {
                call.reject("The Bluetooth link failed: " + err.getMessage());
            }
        });
    }

    @PermissionCallback
    private void afterCallPermission(PluginCall call) {
        call(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        // The Wi-Fi search is bounded; the Bluetooth link is kept for the class.
        JSObject payload = new JSObject();
        payload.put("stopped", true);
        call.resolve(payload);
    }

    @Override
    protected void handleOnDestroy() {
        if (bluetooth != null) {
            bluetooth.close();
            bluetooth = null;
        }
        discovery = null;
        super.handleOnDestroy();
    }

    /* ------------------------------------------------------------------ */

    private void search(PluginCall call) {
        final long timeout = call.getLong("timeoutMs", 4000L);

        getBridge().execute(() -> {
            try {
                if (call.isReleased()) return;

                JSObject diag = new JSObject();
                if (discovery == null) discovery = new Discovery(getContext());

                Discovery.Found found = discovery.discover(timeout);
                diag.put("nsd", discovery.nsdState);
                diag.put("nsdError", discovery.nsdError);
                diag.put("services", discovery.nsdServices);
                diag.put("beacons", discovery.beaconPackets);

                if (found != null) {
                    answer(call, found.url(), found.host, found.port, found.name, found.via, null);
                    return;
                }

                // The Wi-Fi found nothing, or found something this phone cannot
                // open. Bluetooth does not need the network at all.
                if (bluetooth == null) bluetooth = new BtClient(getContext());
                String blocked = bluetooth.problem();
                if (blocked != null) {
                    diag.put("bluetooth", blocked);
                    answer(call, null, null, 0, null, null, diag);
                    return;
                }

                try {
                    BtClient.Found paired = bluetooth.find(Math.max(timeout, 6000));
                    answer(call, null, paired.address, 0, paired.name, "bluetooth", diag);
                    return;
                } catch (IOException noPhone) {
                    diag.put("bluetooth", noPhone.getMessage());
                }

                answer(call, null, null, 0, null, null, diag);
            } catch (RuntimeException err) {
                call.reject("Could not search the class Wi-Fi: " + err.getMessage());
            }
        });
    }

    private void answer(PluginCall call, String url, String host, int port, String name, String via, JSObject diag) {
        JSObject payload = new JSObject();
        if (diag != null) payload.put("diag", diag);
        if (url == null && !"bluetooth".equals(via)) {
            payload.put("found", false);
            if (diag != null && diag.has("bluetooth")) payload.put("error", diag.getString("bluetooth"));
            call.resolve(payload);
            return;
        }
        payload.put("found", true);
        payload.put("via", via);
        payload.put("name", name);
        if (url != null) payload.put("url", url);
        if (host != null) payload.put("host", host);
        payload.put("port", port);
        call.resolve(payload);
    }

    /** Request the runtime Bluetooth permissions once, on the Android that has them. */
    private boolean askForBluetooth(PluginCall call, String callbackName) {
        if (Build.VERSION.SDK_INT < 31) return false;
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) return false;
        requestPermissionForAlias("bluetooth", call, callbackName);
        return true;
    }
}
