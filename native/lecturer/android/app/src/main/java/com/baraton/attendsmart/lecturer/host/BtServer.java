package com.baraton.attendsmart.lecturer.host;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The same class register, reached over Bluetooth instead of Wi-Fi.
 *
 * The campus network isolates clients, so a student can find this phone's
 * address and still not open a socket to it. Bluetooth has no such middlebox:
 * the two phones talk directly. A student that has paired with this phone can
 * find it by walking the paired list, and a fresh one finds it on a scan as
 * long as this phone is discoverable.
 *
 * The protocol is the register's own HTTP: the student writes a request and
 * reads a response, so the routes and the rules stay in one place
 * ({@link ClassServer#serveOne}). One socket carries the whole class, because
 * pairing and connecting per check-in would cost more than the check-in.
 */
public final class BtServer {

    /** Advertised through SDP under this name, and used as the lookup key. */
    public static final String SERVICE_NAME = "CLASSPREF3CT";
    public static final UUID SERVICE_UUID = UUID.fromString("8f1c9d42-6b7e-4c1a-9f10-2d5e7a3b6c88");

    private final ClassServer delegate;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final AtomicInteger students = new AtomicInteger();

    private volatile boolean running;
    private volatile String error;
    private BluetoothServerSocket channel;

    public BtServer(ClassServer delegate) {
        this.delegate = delegate;
    }

    public boolean isRunning() {
        return running;
    }

    /** Why the radio is not listening, for the host card. Null while healthy. */
    public String error() {
        return error;
    }

    public int students() {
        return students.get();
    }

    /** This phone's Bluetooth name, which is what a student sees in settings. */
    public String deviceName() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) return null;
        try {
            return adapter.getName();
        } catch (SecurityException noPermission) {
            return null;
        }
    }

    public void start() throws IOException {
        if (running) return;

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new IOException("This phone has no Bluetooth radio.");
        try {
            if (!adapter.isEnabled()) throw new IOException("Bluetooth is switched off on this phone.");
            // A scan in progress makes this phone refuse to listen.
            adapter.cancelDiscovery();
            channel = adapter.listenUsingInsecureRfcommWithServiceRecord(SERVICE_NAME, SERVICE_UUID);
        } catch (SecurityException denied) {
            throw new IOException("Android has not allowed this app to use Bluetooth.");
        }

        error = null;
        running = true;
        Thread acceptor = new Thread(this::acceptLoop, "attendease-bt");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    public void stop() {
        running = false;
        if (channel != null) {
            try {
                channel.close();
            } catch (IOException ignored) {
                // already closed
            }
            channel = null;
        }
        workers.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                BluetoothSocket client = channel.accept();
                workers.execute(() -> serve(client));
            } catch (IOException stopped) {
                if (!running) return;
                error = stopped.getMessage();
            } catch (RuntimeException stopped) {
                if (!running) return;
                error = stopped.getMessage();
            }
        }
    }

    /** One student, one socket, as many requests as their class needs. */
    private void serve(BluetoothSocket client) {
        students.incrementAndGet();
        try (BluetoothSocket socket = client) {
            InputStream in = new BufferedInputStream(socket.getInputStream(), 8192);
            OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 16384);
            while (running && delegate.serveOne(in, out, false)) {
                // keep answering this student until they hang up
            }
        } catch (IOException | RuntimeException dropped) {
            // a student walking out of range must never stop the class
        } finally {
            students.decrementAndGet();
        }
    }
}
