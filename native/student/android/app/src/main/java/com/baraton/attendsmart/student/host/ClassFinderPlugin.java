package com.baraton.attendsmart.student.host;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Finds the lecturer's phone on the class Wi-Fi.
 *
 * Returns { found, url, host, port, name, via } and never throws for "nothing
 * on the network": the student screen shows the manual address field instead.
 */
@CapacitorPlugin(name = "ClassFinder")
public class ClassFinderPlugin extends Plugin {

    private Discovery discovery;

    @PluginMethod
    public void find(PluginCall call) {
        long timeout = call.getLong("timeoutMs", 4000L);
        try {
            if (discovery == null) discovery = new Discovery(getContext());
            Discovery.Found found = discovery.discover(timeout);

            JSObject payload = new JSObject();
            if (found == null) {
                payload.put("found", false);
            } else {
                payload.put("found", true);
                payload.put("url", found.url());
                payload.put("host", found.host);
                payload.put("port", found.port);
                payload.put("name", found.name);
                payload.put("via", found.via);
            }
            call.resolve(payload);
        } catch (RuntimeException err) {
            call.reject("Could not search the class Wi-Fi: " + err.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        // Discovery is a bounded search; nothing is left running.
        JSObject payload = new JSObject();
        payload.put("stopped", true);
        call.resolve(payload);
    }

    @Override
    protected void handleOnDestroy() {
        discovery = null;
        super.handleOnDestroy();
    }
}
