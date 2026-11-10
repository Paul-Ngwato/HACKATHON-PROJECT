package com.baraton.attendsmart.lecturer.host;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Finding the lecturer's phone on the class Wi-Fi.
 *
 * Two mechanisms run together because campus networks differ: Android NSD
 * (DNS-SD/mDNS) is the clean way, and a UDP broadcast beacon is the fallback
 * for access points that drop multicast. Whichever answers first wins.
 *
 * The lecturer app advertises; the student app discovers. No internet, no
 * cloud, no DNS server involved.
 */
public final class Discovery {

    public static final String SERVICE_TYPE = "_attendease._tcp.";
    public static final int BEACON_PORT = 4174;
    public static final String BEACON_SERVICE = "attendease";

    private final Context context;

    private NsdManager.RegistrationListener registration;
    private DatagramSocket beaconSocket;
    private Thread beaconThread;
    private volatile boolean advertising;

    public Discovery(Context context) {
        this.context = context.getApplicationContext();
    }

    /* ------------------------------------------------------------------ */
    /* Lecturer side: advertise                                            */
    /* ------------------------------------------------------------------ */

    public synchronized void advertise(int port, String label) {
        stopAdvertising();
        advertising = true;

        String safe = label == null || label.trim().isEmpty() ? "class" : label.trim();
        safe = safe.replaceAll("[^A-Za-z0-9 _.-]", "").trim();
        if (safe.length() > 40) safe = safe.substring(0, 40);

        try {
            NsdServiceInfo info = new NsdServiceInfo();
            info.setServiceName("AttendEase " + safe);
            info.setServiceType(SERVICE_TYPE);
            info.setPort(port);

            registration = new NsdManager.RegistrationListener() {
                @Override
                public void onServiceRegistered(NsdServiceInfo serviceInfo) {
                    // The system may rename us if the name is already taken.
                }

                @Override
                public void onRegistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
                    // The UDP beacon still covers this network.
                }

                @Override
                public void onServiceUnregistered(NsdServiceInfo serviceInfo) {
                }

                @Override
                public void onUnregistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
                }
            };
            NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
            if (nsd != null) nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration);
        } catch (RuntimeException ignored) {
            // Fall through to the beacon.
        }

        startBeacon(port, safe);
    }

    private void startBeacon(int port, String name) {
        try {
            DatagramSocket socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setReuseAddress(true);
            beaconSocket = socket;

            JsonObject payload = new JsonObject();
            payload.addProperty("service", BEACON_SERVICE);
            payload.addProperty("port", port);
            payload.addProperty("name", name);
            payload.addProperty("at", System.currentTimeMillis());
            final byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);

            beaconThread = new Thread(() -> {
                while (advertising) {
                    sendBeacon(bytes);
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException stopped) {
                        return;
                    }
                }
            }, "attendease-beacon");
            beaconThread.setDaemon(true);
            beaconThread.start();
        } catch (IOException ignored) {
            beaconSocket = null;
        }
    }

    private void sendBeacon(byte[] bytes) {
        DatagramSocket socket = beaconSocket;
        if (socket == null) return;
        try {
            socket.send(new DatagramPacket(bytes, bytes.length,
                    InetAddress.getByName("255.255.255.255"), BEACON_PORT));
        } catch (IOException ignored) {
            // Try again on the next tick.
        }
        // Some access points only forward the subnet-directed broadcast.
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface network : Collections.list(interfaces)) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (java.net.InterfaceAddress address : network.getInterfaceAddresses()) {
                    InetAddress broadcast = address.getBroadcast();
                    if (broadcast == null) continue;
                    try {
                        socket.send(new DatagramPacket(bytes, bytes.length, broadcast, BEACON_PORT));
                    } catch (IOException ignored) {
                        // One interface failing must not stop the others.
                    }
                }
            }
        } catch (Exception ignored) {
            // No interface list available; the global broadcast already went out.
        }
    }

    public synchronized void stopAdvertising() {
        advertising = false;

        if (registration != null) {
            try {
                NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
                if (nsd != null) nsd.unregisterService(registration);
            } catch (RuntimeException ignored) {
                // Already unregistered.
            }
            registration = null;
        }

        if (beaconThread != null) {
            beaconThread.interrupt();
            beaconThread = null;
        }
        if (beaconSocket != null) {
            beaconSocket.close();
            beaconSocket = null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Student side: discover                                              */
    /* ------------------------------------------------------------------ */

    /** The phone's Wi-Fi address, which students are given without typing it. */
    public static String lanIp() {
        String fallback = null;
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface network : Collections.list(interfaces)) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (java.net.InterfaceAddress address : network.getInterfaceAddresses()) {
                    InetAddress ip = address.getAddress();
                    if (ip == null || ip.getAddress().length != 4 || !ip.isSiteLocalAddress()) continue;
                    String host = ip.getHostAddress();
                    if (network.getName() != null && network.getName().startsWith("wlan")) return host;
                    if (fallback == null) fallback = host;
                }
            }
        } catch (Exception ignored) {
            // No usable interface yet (Wi-Fi still coming up).
        }
        return fallback;
    }

    public static final class Found {
        public final String host;
        public final int port;
        public final String name;
        public final String via;

        Found(String host, int port, String name, String via) {
            this.host = host;
            this.port = port;
            this.name = name;
            this.via = via;
        }

        public String url() {
            return "http://" + host + ":" + port;
        }

        @Override
        public String toString() {
            return url();
        }
    }

    /** Blocking search. Returns null when nothing answered inside the window. */
    public Found discover(long timeoutMs) {
        final long deadline = System.currentTimeMillis() + Math.max(1000L, timeoutMs);
        final BlockingQueue<Found> results = new LinkedBlockingQueue<>();

        NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        NsdManager.DiscoveryListener listener = null;
        WifiManager.MulticastLock multicast = null;

        try {
            if (nsd != null) {
                listener = nsdListener(nsd, results);
                try {
                    nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
                } catch (RuntimeException alreadyRunning) {
                    listener = null;
                }
            }

            try {
                WifiManager wifi = (WifiManager) context.getApplicationContext()
                        .getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    multicast = wifi.createMulticastLock("attendease-discovery");
                    multicast.setReferenceCounted(false);
                    multicast.acquire();
                }
            } catch (RuntimeException ignored) {
                // Broadcast may still arrive without the lock.
            }

            Thread beacon = new Thread(() -> listenForBeacon(results, deadline), "attendease-listen");
            beacon.setDaemon(true);
            beacon.start();

            while (System.currentTimeMillis() < deadline) {
                Found found = results.poll(Math.min(250L, Math.max(1L, deadline - System.currentTimeMillis())),
                        TimeUnit.MILLISECONDS);
                if (found != null) return found;
            }
            return null;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return null;
        } finally {
            if (listener != null && nsd != null) {
                try {
                    nsd.stopServiceDiscovery(listener);
                } catch (RuntimeException ignored) {
                    // Already stopped.
                }
            }
            if (multicast != null) {
                try {
                    multicast.release();
                } catch (RuntimeException ignored) {
                    // Already released.
                }
            }
        }
    }

    private NsdManager.DiscoveryListener nsdListener(final NsdManager nsd,
                                                     final BlockingQueue<Found> results) {
        return new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (serviceInfo == null || !SERVICE_TYPE.equals(serviceInfo.getServiceType())) return;
                try {
                    nsd.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                        @Override
                        public void onResolveFailed(NsdServiceInfo failed, int errorCode) {
                            // The beacon may still answer.
                        }

                        @Override
                        public void onServiceResolved(NsdServiceInfo resolved) {
                            String host = hostOf(resolved);
                            if (host == null || host.isEmpty()) return;
                            results.offer(new Found(host, resolved.getPort(),
                                    resolved.getServiceName(), "nsd"));
                        }
                    });
                } catch (RuntimeException ignored) {
                    // Resolver busy: the next service-found event tries again.
                }
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
            }
        };
    }

    private static String hostOf(NsdServiceInfo info) {
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                java.util.List<java.net.InetAddress> addresses = info.getHostAddresses();
                if (addresses != null && !addresses.isEmpty()) {
                    return addresses.get(0).getHostAddress();
                }
            } catch (RuntimeException ignored) {
                // Fall back to the deprecated accessor.
            }
        }
        InetAddress host = info.getHost();
        return host == null ? null : host.getHostAddress();
    }

    private void listenForBeacon(BlockingQueue<Found> results, long deadline) {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(BEACON_PORT));
            socket.setSoTimeout(300);

            byte[] buffer = new byte[1024];
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (java.net.SocketTimeoutException tick) {
                    continue;
                } catch (IOException closed) {
                    return;
                }

                String text = new String(packet.getData(), packet.getOffset(), packet.getLength(),
                        StandardCharsets.UTF_8);
                Found found = parseBeacon(text, packet.getAddress());
                if (found != null) {
                    results.offer(found);
                    return;
                }
            }
        } catch (IOException ignored) {
            // NSD may still have answered; the caller's timeout decides.
        } finally {
            if (socket != null) socket.close();
        }
    }

    private static Found parseBeacon(String text, InetAddress from) {
        try {
            JsonObject payload = JsonParser.parseString(text).getAsJsonObject();
            if (!BEACON_SERVICE.equals(text(payload, "service"))) return null;
            int port = payload.has("port") ? payload.get("port").getAsInt() : ClassServer.DEFAULT_PORT;
            if (port <= 0 || port > 65535) return null;
            String name = text(payload, "name");
            return new Found(from.getHostAddress(), port,
                    name == null ? "AttendEase class" : name, "beacon");
        } catch (RuntimeException notOurs) {
            return null;
        }
    }

    private static String text(JsonObject object, String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return null;
        try {
            return object.get(key).getAsString();
        } catch (RuntimeException notPrimitive) {
            return null;
        }
    }
}
