package com.baraton.attendsmart.student.host;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.content.ContextCompat;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * The student's lane to the lecturer's phone when Wi-Fi will not carry it.
 *
 * The campus network isolates clients: discovery succeeds, the address looks
 * right, and the socket still never opens. Bluetooth skips the network
 * entirely. This client finds the lecturer either from phones already paired
 * with this one or from a scan while the lecturer's phone is discoverable,
 * then speaks the register's own HTTP over the Bluetooth socket.
 *
 * The link is kept open between requests. Opening it costs a pairing round
 * trip, and a student posts two or three times in one class.
 */
public final class BtClient {

    /** Same service record the lecturer's phone publishes through SDP. */
    static final UUID SERVICE_UUID = UUID.fromString("8f1c9d42-6b7e-4c1a-9f10-2d5e7a3b6c88");

    private static final String PREFS = "attendease-bluetooth";
    private static final String KEY_ADDRESS = "lecturer-address";
    private static final String KEY_NAME = "lecturer-name";
    private static final int MAX_RESPONSE = 4 * 1024 * 1024;

    private final Context context;
    private final Object lock = new Object();

    private BluetoothSocket socket;
    private InputStream in;
    private OutputStream out;
    private String address;
    private String deviceName;
    private long lastUsed;

    public BtClient(Context context) {
        this.context = context.getApplicationContext();
    }

    /** What a phone answers it. */
    public static final class Answer {
        public final int status;
        public final String body;

        Answer(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    public static final class Found {
        public final String name;
        public final String address;

        Found(String name, String address) {
            this.name = name;
            this.address = address;
        }
    }

    /** Null when Bluetooth could work here, otherwise the reason it cannot. */
    public String problem() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) return "This phone has no Bluetooth radio.";
        try {
            if (!adapter.isEnabled()) return "Bluetooth is switched off on this phone.";
        } catch (SecurityException denied) {
            return "Android has not allowed this app to use Bluetooth.";
        }
        return null;
    }

    /**
     * Find the lecturer's phone. Remembers the one that answered last time, so
     * a returning student reconnects without a scan.
     */
    public Found find(long timeoutMs) throws IOException {
        String why = problem();
        if (why != null) throw new IOException(why);

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new IOException("This phone has no Bluetooth radio.");

        // 1. the phone that hosted the last class
        String remembered = prefs().getString(KEY_ADDRESS, null);
        if (remembered != null) {
            try {
                BluetoothDevice device = adapter.getRemoteDevice(remembered);
                if (dial(device, 6000)) return new Found(deviceName, address);
            } catch (IllegalArgumentException unknown) {
                // that phone is gone from this one's memory; keep looking
            }
        }

        // 2. anything this phone is already paired with
        Set<String> paired = new HashSet<>();
        for (BluetoothDevice device : bonded(adapter)) {
            paired.add(device.getAddress());
            if (device.getAddress().equals(remembered)) continue;
            if (dial(device, 3500)) return new Found(deviceName, address);
        }

        // 3. scan, then pair with whoever is advertising the register
        for (BluetoothDevice device : scan(adapter, timeoutMs)) {
            if (paired.contains(device.getAddress())) continue;
            if (!bond(device, 20000)) continue;
            if (dial(device, 5000)) return new Found(deviceName, address);
        }

        throw new IOException("No lecturer phone answered over Bluetooth. Make sure the lecturer has the app open, "
                + "this phone's Bluetooth is on, and the lecturer tapped \"Make this phone findable\".");
    }

    /**
     * One request over the Bluetooth link, reconnecting once if the link went
     * stale while the phone was in a pocket.
     */
    public Answer call(String method, String path, String body) throws IOException {
        synchronized (lock) {
            String why = problem();
            if (why != null) throw new IOException(why);

            if (!connected()) {
                Found found = find(8000);
                if (found == null) throw new IOException("The lecturer phone is not reachable over Bluetooth.");
            }
            try {
                return exchange(method, path, body);
            } catch (IOException stale) {
                closeQuietly();
                BluetoothDevice device = rememberedDevice();
                if (device == null) throw stale;
                if (!dial(device, 6000)) throw stale;
                return exchange(method, path, body);
            }
        }
    }

    public void close() {
        synchronized (lock) {
            closeQuietly();
        }
    }

    /* ------------------------------------------------------------------ */
    /* The wire                                                            */
    /* ------------------------------------------------------------------ */

    private Answer exchange(String method, String path, String body) throws IOException {
        if (out == null || in == null) throw new IOException("No Bluetooth link to the lecturer phone.");

        byte[] payload = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        String head = method + " " + path + " HTTP/1.1\r\n"
                + "Host: bluetooth\r\n"
                // The register gzips big snapshots for the browser; this reader
                // wants the bytes as they were written.
                + "Accept-Encoding: identity\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: " + payload.length + "\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        if (payload.length > 0) out.write(payload);
        out.flush();

        String statusLine = readLine(in);
        if (statusLine == null) throw new IOException("The lecturer phone closed the Bluetooth link.");
        int status = 0;
        String[] parts = statusLine.split(" ");
        if (parts.length >= 2) {
            try {
                status = Integer.parseInt(parts[1].trim());
            } catch (NumberFormatException ignored) {
                // an odd status line still leaves the body readable
            }
        }

        Map<String, String> headers = new HashMap<>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(Locale.US), line.substring(colon + 1).trim());
        }

        int length = 0;
        String declared = headers.get("content-length");
        if (declared != null) {
            try {
                length = Integer.parseInt(declared.trim());
            } catch (NumberFormatException ignored) {
                length = 0;
            }
        }
        if (length < 0 || length > MAX_RESPONSE) throw new IOException("That answer was too large for Bluetooth.");

        byte[] buffer = new byte[length];
        int read = 0;
        while (read < length) {
            int chunk = in.read(buffer, read, length - read);
            if (chunk < 0) throw new IOException("The Bluetooth link dropped mid-answer.");
            read += chunk;
        }
        lastUsed = System.currentTimeMillis();
        return new Answer(status, new String(buffer, 0, read, StandardCharsets.UTF_8));
    }

    /* ------------------------------------------------------------------ */
    /* Finding and connecting                                              */
    /* ------------------------------------------------------------------ */

    /** Connect and prove the other end is a register, not just a paired phone. */
    private boolean dial(BluetoothDevice device, long timeoutMs) {
        BluetoothSocket candidate;
        try {
            candidate = device.createInsecureRfcommSocketToServiceRecord(SERVICE_UUID);
        } catch (IOException | SecurityException noService) {
            return false;
        }

        FutureTask<Void> open = new FutureTask<>(() -> {
            candidate.connect();
            return null;
        });
        Thread dialer = new Thread(open, "attendease-bt-dial");
        dialer.setDaemon(true);
        dialer.start();
        try {
            open.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException slow) {
            open.cancel(true);
            closeQuietly(candidate);
            return false;
        } catch (ExecutionException failed) {
            closeQuietly(candidate);
            return false;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            closeQuietly(candidate);
            return false;
        }

        synchronized (lock) {
            closeQuietly();
            socket = candidate;
            try {
                in = new BufferedInputStream(candidate.getInputStream(), 8192);
                out = new BufferedOutputStream(candidate.getOutputStream(), 16384);
            } catch (IOException gone) {
                closeQuietly();
                return false;
            }
            address = device.getAddress();
            deviceName = nameOf(device);
            lastUsed = System.currentTimeMillis();
            prefs().edit().putString(KEY_ADDRESS, address).putString(KEY_NAME, deviceName).apply();
        }
        return true;
    }

    private boolean connected() {
        if (socket == null || !socket.isConnected()) return false;
        return System.currentTimeMillis() - lastUsed < 120000;
    }

    private BluetoothDevice rememberedDevice() {
        String saved = prefs().getString(KEY_ADDRESS, null);
        if (saved == null) return null;
        try {
            return BluetoothAdapter.getDefaultAdapter().getRemoteDevice(saved);
        } catch (IllegalArgumentException | SecurityException unknown) {
            return null;
        }
    }

    private List<BluetoothDevice> bonded(BluetoothAdapter adapter) {
        try {
            Set<BluetoothDevice> devices = adapter.getBondedDevices();
            return devices == null ? new ArrayList<>() : new ArrayList<>(devices);
        } catch (SecurityException denied) {
            return new ArrayList<>();
        }
    }

    /** Discoverable devices seen during a scan. Never throws for an empty room. */
    private List<BluetoothDevice> scan(BluetoothAdapter adapter, long timeoutMs) {
        List<BluetoothDevice> seen = new ArrayList<>();
        Set<String> addresses = new HashSet<>();
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context from, Intent intent) {
                if (!BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) return;
                BluetoothDevice device = Build.VERSION.SDK_INT >= 33
                        ? intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class)
                        : intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device == null) return;
                synchronized (seen) {
                    if (addresses.add(device.getAddress())) seen.add(device);
                }
            }
        };

        try {
            ContextCompat.registerReceiver(context, receiver,
                    new IntentFilter(BluetoothDevice.ACTION_FOUND), ContextCompat.RECEIVER_NOT_EXPORTED);
            adapter.startDiscovery();
            long deadline = System.currentTimeMillis() + Math.max(1500, timeoutMs);
            while (System.currentTimeMillis() < deadline) {
                Thread.sleep(150);
            }
        } catch (SecurityException denied) {
            return new ArrayList<>();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } finally {
            try {
                adapter.cancelDiscovery();
            } catch (SecurityException ignored) {
                // discovery is already over
            }
            try {
                context.unregisterReceiver(receiver);
            } catch (IllegalArgumentException alreadyGone) {
                // never registered
            }
        }
        synchronized (seen) {
            return new ArrayList<>(seen);
        }
    }

    /** Ask Android to pair. The user confirms on both phones the first time. */
    private boolean bond(BluetoothDevice device, long timeoutMs) {
        try {
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) return true;
            if (!device.createBond()) return false;
        } catch (SecurityException denied) {
            return false;
        }

        long deadline = System.currentTimeMillis() + timeoutMs;
        long settle = System.currentTimeMillis() + 1500;
        while (System.currentTimeMillis() < deadline) {
            try {
                int state = device.getBondState();
                if (state == BluetoothDevice.BOND_BONDED) return true;
                // NONE right after the request only means Android has not
                // started the dialog yet.
                if (state == BluetoothDevice.BOND_NONE && System.currentTimeMillis() > settle) return false;
                Thread.sleep(250);
            } catch (SecurityException denied) {
                return false;
            } catch (InterruptedException stop) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    private String nameOf(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null || name.isEmpty() ? device.getAddress() : name;
        } catch (SecurityException denied) {
            return device.getAddress();
        }
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void closeQuietly() {
        if (socket != null) {
            closeQuietly(socket);
            socket = null;
        }
        in = null;
        out = null;
    }

    private static void closeQuietly(BluetoothSocket target) {
        try {
            target.close();
        } catch (IOException ignored) {
            // already closed
        }
    }

    private static String readLine(InputStream stream) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(128);
        int value;
        boolean any = false;
        while ((value = stream.read()) >= 0) {
            any = true;
            if (value == '\n') break;
            if (value != '\r') buffer.write(value);
            if (buffer.size() > 8192) break;
        }
        if (!any && buffer.size() == 0) return null;
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }
}
