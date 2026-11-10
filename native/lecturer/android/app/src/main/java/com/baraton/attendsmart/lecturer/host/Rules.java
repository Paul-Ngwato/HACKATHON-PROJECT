package com.baraton.attendsmart.lecturer.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;
import java.util.TimeZone;

/**
 * AttendEase domain rules, hosted on the lecturer's phone.
 *
 * This is the same contract the laptop server enforces, moved onto the device
 * that runs the class: session live -> enrolled student -> GPS fence -> no
 * duplicate (session and calendar day) -> device lock. The phone is the only
 * writer, so the rules are still decided in one place.
 */
public final class Rules {

    public static final int LATE_GRACE_MIN = 5;

    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");
    private static final Random RANDOM = new Random();
    private static final String[] DAY_NAMES = {
            "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
    };

    public static final class ApiError extends Exception {
        public final int status;

        public ApiError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private Rules() {
    }

    /* ------------------------------------------------------------------ */
    /* Time and identifiers                                                */
    /* ------------------------------------------------------------------ */

    public static String nowIso() {
        return iso(System.currentTimeMillis());
    }

    static String iso(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(UTC);
        return format.format(new Date(millis));
    }

    static long at(String iso) {
        if (iso == null) return 0L;
        for (String pattern : new String[]{"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"}) {
            try {
                SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
                format.setTimeZone(UTC);
                Date parsed = format.parse(iso);
                if (parsed != null) return parsed.getTime();
            } catch (Exception ignored) {
                // try the next pattern
            }
        }
        return 0L;
    }

    /** "09:37 AM", in the phone's own timezone, as the app shows it. */
    static String clock(String iso) {
        SimpleDateFormat format = new SimpleDateFormat("hh:mm a", Locale.US);
        return format.format(new Date(at(iso)));
    }

    static String id(String prefix) {
        StringBuilder tail = new StringBuilder();
        for (int i = 0; i < 4; i++) {
            tail.append(String.format(Locale.US, "%02x", RANDOM.nextInt(256)));
        }
        return prefix + "-" + Long.toString(System.currentTimeMillis(), 36) + "-" + tail;
    }

    static String rand4(JsonArray sessions) throws ApiError {
        for (int attempt = 0; attempt < 50; attempt++) {
            String code = String.valueOf(1000 + RANDOM.nextInt(9000));
            boolean clash = false;
            for (JsonElement element : sessions) {
                JsonObject session = element.getAsJsonObject();
                if (code.equals(text(session, "code")) && "active".equals(text(session, "status"))) {
                    clash = true;
                    break;
                }
            }
            if (!clash) return code;
        }
        throw new ApiError(503, "Could not allocate an attendance code. Try again.");
    }

    /* ------------------------------------------------------------------ */
    /* JSON helpers                                                        */
    /* ------------------------------------------------------------------ */

    static JsonArray arr(JsonObject doc, String key) {
        JsonElement value = doc.get(key);
        if (value == null || !value.isJsonArray()) {
            JsonArray created = new JsonArray();
            doc.add(key, created);
            return created;
        }
        return value.getAsJsonArray();
    }

    static JsonObject find(JsonArray array, String idValue) {
        if (idValue == null) return null;
        for (JsonElement element : array) {
            if (!element.isJsonObject()) continue;
            JsonObject row = element.getAsJsonObject();
            if (idValue.equals(text(row, "id"))) return row;
        }
        return null;
    }

    static JsonObject findBy(JsonArray array, String field, String value) {
        if (value == null) return null;
        for (JsonElement element : array) {
            if (!element.isJsonObject()) continue;
            JsonObject row = element.getAsJsonObject();
            if (value.equals(text(row, field))) return row;
        }
        return null;
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

    static String textOr(JsonObject object, String key, String fallback) {
        String value = text(object, key);
        return value == null ? fallback : value;
    }

    static Double num(JsonObject object, String key) {
        if (object == null) return null;
        JsonElement value = object.get(key);
        if (value == null || value.isJsonNull()) return null;
        try {
            return value.getAsDouble();
        } catch (RuntimeException notNumber) {
            return null;
        }
    }

    static Integer intOr(JsonObject object, String key, Integer fallback) {
        Double value = num(object, key);
        return value == null ? fallback : (int) Math.round(value);
    }

    static void put(JsonObject object, String key, String value) {
        if (value == null) object.add(key, JsonNull.INSTANCE);
        else object.addProperty(key, value);
    }

    static void put(JsonObject object, String key, Number value) {
        if (value == null) object.add(key, JsonNull.INSTANCE);
        else object.addProperty(key, value);
    }

    static boolean has(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull();
    }

    static int clamp(int low, int high, int value) {
        return Math.max(low, Math.min(high, value));
    }

    static double[] validCoords(Double lat, Double lng) {
        if (lat == null || lng == null) return null;
        if (Double.isNaN(lat) || Double.isNaN(lng) || Double.isInfinite(lat) || Double.isInfinite(lng)) return null;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        // 0,0 means the device never got a fix; venue rows also start there.
        if (lat == 0d && lng == 0d) return null;
        return new double[]{lat, lng};
    }

    static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double radius = 6371000d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
        return 2 * radius * Math.asin(Math.sqrt(a));
    }

    /* ------------------------------------------------------------------ */
    /* Lookups                                                            */
    /* ------------------------------------------------------------------ */

    static JsonObject courseRow(JsonObject doc, String courseId) {
        return find(arr(doc, "courses"), courseId);
    }

    static JsonObject studentRow(JsonObject doc, String studentId) {
        return find(arr(doc, "students"), studentId);
    }

    static JsonObject hallRow(JsonObject doc, String hallId) {
        return find(arr(doc, "halls"), hallId);
    }

    static JsonObject sessionRow(JsonObject doc, String sessionId) {
        return find(arr(doc, "sessions"), sessionId);
    }

    static JsonArray studentIds(JsonObject course) {
        if (course == null) return new JsonArray();
        JsonElement value = course.get("studentIds");
        return value != null && value.isJsonArray() ? value.getAsJsonArray() : new JsonArray();
    }

    static boolean enrolled(JsonObject course, String studentId) {
        if (course == null || studentId == null) return false;
        for (JsonElement element : studentIds(course)) {
            if (studentId.equals(element.getAsString())) return true;
        }
        return false;
    }

    /** Close windows whose end time has passed. True when anything changed. */
    public static boolean sweepExpired(JsonObject doc) {
        String now = nowIso();
        boolean changed = false;
        for (JsonElement element : arr(doc, "sessions")) {
            JsonObject session = element.getAsJsonObject();
            if (!"active".equals(text(session, "status"))) continue;
            String endsAt = text(session, "endsAt");
            if (endsAt != null && endsAt.compareTo(now) <= 0) {
                put(session, "status", "ended");
                put(session, "endedAt", endsAt);
                changed = true;
            }
        }
        return changed;
    }

    static JsonObject activeSessionForCourse(JsonObject doc, String courseId) {
        JsonObject best = null;
        for (JsonElement element : arr(doc, "sessions")) {
            JsonObject session = element.getAsJsonObject();
            if (!"active".equals(text(session, "status"))) continue;
            if (!textOr(session, "courseId", "").equals(courseId == null ? "" : courseId)) continue;
            if (best == null || textOr(session, "startedAt", "").compareTo(textOr(best, "startedAt", "")) > 0) {
                best = session;
            }
        }
        return best;
    }

    static void assertCourseOwner(JsonObject course, String actorId) throws ApiError {
        if (actorId == null || actorId.isEmpty()) {
            throw new ApiError(401, "Sign in again — your session was not sent with the request.");
        }
        if (!actorId.equals(text(course, "lecturerId"))) {
            throw new ApiError(403, "This course belongs to another lecturer.");
        }
    }

    /** The fence that applies to a session: the lecturer's own fix, else the hall. */
    public static JsonObject venueFor(JsonObject doc, JsonObject session) {
        JsonObject hall = session == null ? null : hallRow(doc, text(session, "hallId"));
        double[] sessionFix = session == null ? null : validCoords(num(session, "lat"), num(session, "lng"));
        Double lat = sessionFix != null ? sessionFix[0] : (hall == null ? null : num(hall, "lat"));
        Double lng = sessionFix != null ? sessionFix[1] : (hall == null ? null : num(hall, "lng"));
        Integer sessionRadius = session == null ? null : intOr(session, "radius", null);
        Integer radius = sessionRadius != null ? sessionRadius
                : hall == null ? null : intOr(hall, "radius", 30);

        JsonObject venue = new JsonObject();
        put(venue, "id", hall == null ? null : text(hall, "id"));
        put(venue, "name", hall == null ? "Classroom" : textOr(hall, "name", "Classroom"));
        put(venue, "building", hall == null ? "" : textOr(hall, "building", ""));
        put(venue, "lat", lat);
        put(venue, "lng", lng);
        put(venue, "radius", radius == null ? 30 : radius);
        venue.addProperty("captured", sessionFix != null);
        return venue;
    }

    /* ------------------------------------------------------------------ */
    /* Sessions                                                            */
    /* ------------------------------------------------------------------ */

    public static JsonObject startSession(Register reg, String courseId, String lecturerId, Integer durationMin,
                                          Double lat, Double lng, Double accuracy, Double radius) throws ApiError {
        JsonObject doc = reg.doc();
        boolean swept = sweepExpired(doc);

        JsonObject course = courseRow(doc, courseId);
        if (course == null) throw new ApiError(404, "Course not found.");
        assertCourseOwner(course, lecturerId);

        double[] fix = validCoords(lat, lng);
        int fence = clamp(10, 200, radius == null ? 30 : (int) Math.round(radius));
        Integer acc = accuracy == null ? null : (int) Math.round(accuracy);

        JsonObject existing = activeSessionForCourse(doc, courseId);
        if (existing != null) {
            // Re-opening a live window refreshes its official location.
            if (fix != null) {
                put(existing, "lat", fix[0]);
                put(existing, "lng", fix[1]);
                put(existing, "radius", fence);
                put(existing, "accuracy", acc);
                reg.bump();
                return existing;
            }
            if (swept) reg.bump();
            return existing;
        }

        if (fix == null) {
            JsonObject hall = hallRow(doc, text(course, "hallId"));
            double[] hallFix = hall == null ? null : validCoords(num(hall, "lat"), num(hall, "lng"));
            if (hallFix == null) {
                throw new ApiError(400, "Capture the class location before starting attendance. "
                        + "Enable precise location on this phone, or scan the BT-821C.");
            }
            fix = hallFix;
        }

        int minutes = clamp(5, 60, durationMin != null ? durationMin : intOr(course, "windowMinutes", 10));
        long startedAt = System.currentTimeMillis();
        long endsAt = startedAt + minutes * 60000L;
        String sessionId = id("sess");
        JsonArray sessions = arr(doc, "sessions");
        String code = rand4(sessions);
        int day = intOr(course, "day", 0);
        String dayName = DAY_NAMES[Math.max(0, Math.min(6, day))];

        JsonObject session = new JsonObject();
        put(session, "id", sessionId);
        put(session, "courseId", text(course, "id"));
        put(session, "lecturerId", text(course, "lecturerId"));
        put(session, "hallId", text(course, "hallId"));
        put(session, "code", code);
        put(session, "token", "ATTENDEASE|" + sessionId + "|" + code + "|" + Long.toString(System.currentTimeMillis(), 36));
        put(session, "bleName", textOr(course, "code", "CLASS").toUpperCase(Locale.US) + "_" + dayName + "_CLASS");
        put(session, "startedAt", iso(startedAt));
        put(session, "endsAt", iso(endsAt));
        put(session, "durationMin", minutes);
        put(session, "lat", fix[0]);
        put(session, "lng", fix[1]);
        put(session, "radius", fence);
        put(session, "accuracy", acc);
        put(session, "status", "active");
        put(session, "endedAt", (String) null);
        session.addProperty("seeded", false);

        sessions.add(session);
        reg.bump();
        return session;
    }

    public static JsonObject endSession(Register reg, String sessionId, String actorId) throws ApiError {
        JsonObject doc = reg.doc();
        JsonObject session = sessionRow(doc, sessionId);
        if (session == null) throw new ApiError(404, "Session not found.");
        String lecturerId = text(session, "lecturerId");
        if (actorId != null && !actorId.equals(lecturerId) && !"a1".equals(actorId)) {
            throw new ApiError(403, "Only the lecturer who opened this window can close it.");
        }
        if (!"ended".equals(text(session, "status"))) {
            put(session, "status", "ended");
            put(session, "endedAt", nowIso());
            reg.bump();
        }
        return session;
    }

    public static JsonObject rotateCode(Register reg, String sessionId, String actorId) throws ApiError {
        JsonObject doc = reg.doc();
        JsonObject session = sessionRow(doc, sessionId);
        if (session == null) throw new ApiError(404, "Session not found.");
        if (!"active".equals(text(session, "status"))) {
            throw new ApiError(409, "This attendance window has already closed.");
        }
        String lecturerId = text(session, "lecturerId");
        if (actorId != null && !actorId.equals(lecturerId) && !"a1".equals(actorId)) {
            throw new ApiError(403, "Only the lecturer who opened this window can change the code.");
        }
        JsonArray sessions = arr(doc, "sessions");
        String code = rand4(sessions);
        put(session, "code", code);
        put(session, "token", "ATTENDEASE|" + sessionId + "|" + code + "|" + Long.toString(System.currentTimeMillis(), 36));
        reg.bump();
        return session;
    }

    /* ------------------------------------------------------------------ */
    /* Code lookup                                                         */
    /* ------------------------------------------------------------------ */

    static String cleanCode(String code) {
        if (code == null) return "";
        String digits = code.replaceAll("\\D", "");
        return digits.length() > 4 ? digits.substring(0, 4) : digits;
    }

    static JsonObject latestActiveByCode(JsonObject doc, String code) {
        JsonObject best = null;
        for (JsonElement element : arr(doc, "sessions")) {
            JsonObject session = element.getAsJsonObject();
            if (!"active".equals(text(session, "status"))) continue;
            if (!code.equals(text(session, "code"))) continue;
            if (best == null || textOr(session, "startedAt", "").compareTo(textOr(best, "startedAt", "")) > 0) {
                best = session;
            }
        }
        return best;
    }

    static JsonObject failure(String step, String message) {
        JsonObject result = new JsonObject();
        result.addProperty("ok", false);
        put(result, "step", step);
        put(result, "message", message);
        return result;
    }

    public static JsonObject lookupSession(Register reg, String code, String studentId) throws ApiError {
        JsonObject doc = reg.doc();
        if (sweepExpired(doc)) reg.bump();

        String clean = cleanCode(code);
        if (clean.length() != 4) throw new ApiError(400, "Enter the four-digit code shown by your lecturer.");

        JsonObject session = latestActiveByCode(doc, clean);
        if (session == null) {
            return failure("code", "No open attendance session matches that code. Check the four digits and try again.");
        }

        JsonObject course = courseRow(doc, text(session, "courseId"));
        JsonObject venue = venueFor(doc, session);
        JsonObject lecturer = findBy(arr(doc, "lecturers"), "id", text(session, "lecturerId"));
        long minutesLeft = Math.max(0L, Math.round((at(text(session, "endsAt")) - System.currentTimeMillis()) / 60000d));

        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        result.add("session", session);
        result.add("course", course == null ? JsonNull.INSTANCE : course);
        result.add("hall", venue);
        result.add("lecturer", lecturer == null ? JsonNull.INSTANCE : lecturer);
        result.addProperty("enrolled", studentId != null && enrolled(course, studentId));
        result.addProperty("minutesLeft", minutesLeft);
        return result;
    }

    /* ------------------------------------------------------------------ */
    /* Check-in                                                            */
    /* ------------------------------------------------------------------ */

    static void securityEvent(JsonObject doc, String sessionId, String courseId, String studentId,
                              String type, String detail) {
        JsonObject event = new JsonObject();
        put(event, "id", id("sec"));
        put(event, "at", nowIso());
        put(event, "sessionId", sessionId);
        put(event, "courseId", courseId);
        put(event, "studentId", studentId);
        put(event, "type", type);
        put(event, "detail", detail);
        arr(doc, "securityEvents").add(event);
    }

    static JsonObject recordJson(JsonObject record) {
        JsonObject copy = new JsonObject();
        put(copy, "id", text(record, "id"));
        put(copy, "sessionId", text(record, "sessionId"));
        put(copy, "courseId", text(record, "courseId"));
        put(copy, "studentId", text(record, "studentId"));
        put(copy, "checkedInAt", text(record, "checkedInAt"));
        put(copy, "method", text(record, "method"));
        put(copy, "distanceM", intOr(record, "distanceM", null));
        put(copy, "status", text(record, "status"));
        put(copy, "deviceId", text(record, "deviceId"));
        return copy;
    }

    /**
     * The one place a record can be created. Every gate runs before anything is
     * written, so a refused check-in leaves the register untouched.
     */
    public static JsonObject checkIn(Register reg, String code, String studentId, String deviceId,
                                     Double lat, Double lng, Double accuracy, String method) {
        JsonObject doc = reg.doc();
        boolean swept = sweepExpired(doc);

        String clean = cleanCode(code);
        if (clean.length() != 4) {
            if (swept) reg.bump();
            return failure("code", "Enter the four-digit code shown by your lecturer.");
        }

        JsonObject session = latestActiveByCode(doc, clean);
        if (session == null) {
            if (swept) reg.bump();
            return failure("code", "That code is not open right now. Ask your lecturer for the current four digits.");
        }

        JsonObject course = courseRow(doc, text(session, "courseId"));
        JsonObject student = studentRow(doc, studentId);
        JsonObject venue = venueFor(doc, session);
        if (course == null || student == null || validCoords(num(venue, "lat"), num(venue, "lng")) == null) {
            return failure("session", "Invalid course, student or class location.");
        }
        String courseCode = textOr(course, "code", "this unit");

        if (!enrolled(course, studentId)) {
            securityEvent(doc, text(session, "id"), text(course, "id"), studentId, "unregistered_attempt",
                    textOr(student, "name", "Student") + " (" + textOr(student, "regNo", "?") + ") tried to post attendance for "
                            + courseCode + " but is not on the final register.");
            reg.bump();
            return failure("enrolled", "You are not on the final register for " + courseCode
                    + ". This attempt was recorded and will be shown to the lecturer.");
        }

        JsonArray attendance = arr(doc, "attendance");
        JsonObject duplicate = null;
        for (JsonElement element : attendance) {
            JsonObject row = element.getAsJsonObject();
            if (text(session, "id").equals(text(row, "sessionId")) && studentId.equals(text(row, "studentId"))) {
                duplicate = row;
                break;
            }
        }
        if (duplicate != null) {
            JsonObject result = failure("duplicate", "Attendance was already posted for you at "
                    + clock(text(duplicate, "checkedInAt")) + ". A posted record cannot be changed.");
            result.add("record", recordJson(duplicate));
            return result;
        }

        // One post per class per calendar day: closing and reopening a window for
        // the same unit must not become a second chance.
        String today = nowIso().substring(0, 10);
        JsonObject sameDay = null;
        for (JsonElement element : attendance) {
            JsonObject row = element.getAsJsonObject();
            if (!studentId.equals(text(row, "studentId"))) continue;
            if (!text(course, "id").equals(text(row, "courseId"))) continue;
            String at = textOr(row, "checkedInAt", "");
            if (!at.startsWith(today)) continue;
            if (sameDay == null || at.compareTo(textOr(sameDay, "checkedInAt", "")) < 0) sameDay = row;
        }
        if (sameDay != null && !text(session, "id").equals(text(sameDay, "sessionId"))) {
            JsonObject result = failure("duplicate", "You already posted attendance for " + courseCode + " today at "
                    + clock(text(sameDay, "checkedInAt")) + ". A class is recorded once, so this cannot be repeated.");
            result.add("record", recordJson(sameDay));
            return result;
        }

        String boundDevice = deviceId == null ? "" : deviceId.trim();
        JsonObject lock = boundDevice.isEmpty() ? null : findBy(arr(doc, "identityLocks"), "deviceId", boundDevice);
        if (lock != null && !studentId.equals(text(lock, "studentId"))) {
            JsonObject owner = studentRow(doc, text(lock, "studentId"));
            securityEvent(doc, text(session, "id"), text(course, "id"), studentId, "identity_locked",
                    textOr(student, "name", "Student") + " tried to post from a device permanently bound to "
                            + (owner == null ? "another student" : textOr(owner, "name", "another student"))
                            + ". Identity cannot be reassigned.");
            reg.bump();
            return failure("identity", "This device is permanently bound to another student. Attendance cannot be reassigned.");
        }

        if (lat == null || lng == null || Double.isNaN(lat) || Double.isNaN(lng)
                || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return failure("gps", "GPS location was not captured. Enable location and try again.");
        }

        double distance = haversine(lat, lng, num(venue, "lat"), num(venue, "lng"));
        int radius = intOr(venue, "radius", 30);
        if (distance > radius) {
            JsonObject result = failure("gps", "You are " + Math.round(distance) + " m from the class location. Attendance requires you within "
                    + radius + " m, even with the correct code.");
            result.addProperty("distanceM", Math.round(distance));
            return result;
        }

        double elapsedMinutes = (System.currentTimeMillis() - at(text(session, "startedAt"))) / 60000d;

        JsonObject record = new JsonObject();
        put(record, "id", id("att"));
        put(record, "sessionId", text(session, "id"));
        put(record, "courseId", text(course, "id"));
        put(record, "studentId", studentId);
        put(record, "checkedInAt", nowIso());
        put(record, "method", method == null || method.isEmpty() ? "code" : method);
        put(record, "distanceM", (int) Math.round(distance));
        put(record, "status", elapsedMinutes > LATE_GRACE_MIN ? "late" : "present");
        put(record, "deviceId", boundDevice.isEmpty() ? "unknown-device" : boundDevice);
        attendance.add(record);

        if (!boundDevice.isEmpty() && lock == null) {
            JsonObject binding = new JsonObject();
            put(binding, "deviceId", boundDevice);
            put(binding, "studentId", studentId);
            put(binding, "at", nowIso());
            arr(doc, "identityLocks").add(binding);
        }

        reg.bump();

        JsonObject result = new JsonObject();
        result.addProperty("ok", true);
        put(result, "step", "done");
        result.add("record", recordJson(record));
        result.add("session", session);
        result.add("course", course);
        result.add("hall", venue);
        put(result, "accuracy", accuracy == null ? null : (int) Math.round(accuracy));
        return result;
    }

    /* ------------------------------------------------------------------ */
    /* Semester setup                                                      */
    /* ------------------------------------------------------------------ */

    public static JsonObject createCourse(Register reg, JsonObject payload, String actorId) throws ApiError {
        JsonObject doc = reg.doc();
        String name = textOr(payload, "name", "").trim().replaceAll("\\s+", " ");
        String code = textOr(payload, "code", "").trim().toUpperCase(Locale.US).replaceAll("\\s+", "");
        String room = textOr(payload, "room", "").trim();
        if (room.length() > 80) room = room.substring(0, 80);
        String lecturerId = textOr(payload, "lecturerId", actorId == null ? "" : actorId).trim();

        if (name.isEmpty()) throw new ApiError(400, "Enter the unit name, for example Database Systems.");
        if (code.isEmpty()) throw new ApiError(400, "Enter the course code, for example BBIT421.");

        JsonObject lecturer = findBy(arr(doc, "lecturers"), "id", lecturerId);
        if (lecturer == null) throw new ApiError(404, "Lecturer account not found.");
        if (actorId != null && !actorId.equals(lecturerId) && !"a1".equals(actorId)) {
            throw new ApiError(403, "You can only create units for your own account.");
        }

        Calendar calendar = Calendar.getInstance();
        int today = calendar.get(Calendar.DAY_OF_WEEK) - 1;
        int day = payload.has("day") && !payload.get("day").isJsonNull()
                ? (int) Math.round(num(payload, "day")) : today;
        if (day < 0 || day > 6) throw new ApiError(400, "Pick a valid weekday.");

        String start = validTime(textOr(payload, "start", "")) ? text(payload, "start") : "08:00";
        String end = validTime(textOr(payload, "end", "")) ? text(payload, "end") : "10:00";
        if (end.compareTo(start) <= 0) throw new ApiError(400, "The unit must end after it starts.");

        int minutes = clamp(5, 60, intOr(payload, "windowMinutes", 10));
        String semester = textOr(payload, "semester", "").trim();
        if (semester.length() > 40) semester = semester.substring(0, 40);
        String department = textOr(payload, "department", textOr(lecturer, "department", "")).trim();
        if (department.length() > 80) department = department.substring(0, 80);

        String courseId = id("course");
        String hallId = "room-" + courseId;
        String roomName = room.isEmpty() ? code + " classroom" : room;

        JsonObject hall = new JsonObject();
        put(hall, "id", hallId);
        put(hall, "name", roomName);
        put(hall, "building", "Created unit");
        put(hall, "lat", 0);
        put(hall, "lng", 0);
        put(hall, "radius", 30);
        arr(doc, "halls").add(hall);

        JsonObject course = new JsonObject();
        put(course, "id", courseId);
        put(course, "code", code);
        put(course, "name", name);
        put(course, "department", department);
        put(course, "lecturerId", lecturerId);
        put(course, "day", day);
        put(course, "start", start);
        put(course, "end", end);
        put(course, "hallId", hallId);
        put(course, "credits", 3);
        put(course, "semester", semester);
        put(course, "windowMinutes", minutes);
        put(course, "room", roomName);
        put(course, "rosterFinalizedAt", (String) null);
        put(course, "venueCapturedAt", (String) null);
        put(course, "venueAccuracy", (Integer) null);
        course.add("studentIds", new JsonArray());
        arr(doc, "courses").add(course);

        reg.bump();
        return course;
    }

    static boolean validTime(String value) {
        return value != null && value.matches("\\d{2}:\\d{2}");
    }

    public static JsonObject updateCourseSetup(Register reg, String courseId, JsonObject patch, String actorId)
            throws ApiError {
        JsonObject doc = reg.doc();
        JsonObject course = courseRow(doc, courseId);
        if (course == null) throw new ApiError(404, "Course not found.");
        assertCourseOwner(course, actorId);
        if (has(course, "rosterFinalizedAt")) throw new ApiError(409, "This class is already final for the semester.");

        String hallId = textOr(course, "hallId", "");
        int day = intOr(course, "day", 0);
        String start = textOr(course, "start", "08:00");
        String end = textOr(course, "end", "10:00");
        int minutes = intOr(course, "windowMinutes", 10);
        String semester = textOr(course, "semester", "");
        String room = textOr(course, "room", "");

        if (patch.has("hallId")) {
            String next = text(patch, "hallId");
            if (hallRow(doc, next) == null) throw new ApiError(400, "Unknown lecture hall.");
            hallId = next;
        }
        if (patch.has("day")) {
            int next = (int) Math.round(num(patch, "day"));
            if (next < 0 || next > 6) throw new ApiError(400, "Pick a valid weekday.");
            day = next;
        }
        for (String key : new String[]{"start", "end"}) {
            if (!patch.has(key)) continue;
            String value = text(patch, key);
            if (!validTime(value)) throw new ApiError(400, "Time must look like 08:00.");
            if ("start".equals(key)) start = value; else end = value;
        }
        if (end.compareTo(start) <= 0) throw new ApiError(400, "The class must end after it starts.");
        if (patch.has("windowMinutes")) {
            Double value = num(patch, "windowMinutes");
            if (value == null || value < 5 || value > 60) {
                throw new ApiError(400, "Attendance window must be 5–60 minutes.");
            }
            minutes = (int) Math.round(value);
        }
        if (patch.has("semester")) {
            String value = textOr(patch, "semester", "").trim();
            if (!value.isEmpty()) semester = value.length() > 40 ? value.substring(0, 40) : value;
        }
        if (patch.has("room")) {
            String value = textOr(patch, "room", "").trim();
            if (!value.isEmpty()) room = value.length() > 80 ? value.substring(0, 80) : value;
        }

        put(course, "hallId", hallId);
        put(course, "day", day);
        put(course, "start", start);
        put(course, "end", end);
        put(course, "windowMinutes", minutes);
        put(course, "semester", semester);
        put(course, "room", room);
        reg.bump();
        return course;
    }

    public static JsonObject setCourseRoster(Register reg, String courseId, JsonArray ids, String actorId)
            throws ApiError {
        JsonObject doc = reg.doc();
        JsonObject course = courseRow(doc, courseId);
        if (course == null) throw new ApiError(404, "Course not found.");
        assertCourseOwner(course, actorId);
        if (has(course, "rosterFinalizedAt")) throw new ApiError(409, "The register is final and cannot be changed.");

        Set<String> unique = new HashSet<>();
        List<String> kept = new ArrayList<>();
        for (JsonElement element : ids == null ? new JsonArray() : ids) {
            String studentId = element.getAsString();
            if (!unique.add(studentId)) continue;
            if (studentRow(doc, studentId) != null) kept.add(studentId);
        }
        JsonArray roster = new JsonArray();
        for (String studentId : kept) roster.add(studentId);
        course.add("studentIds", roster);
        reg.bump();
        return course;
    }

    public static JsonObject finalizeCourseRoster(Register reg, String courseId, String actorId) throws ApiError {
        JsonObject course = courseRow(reg.doc(), courseId);
        if (course == null) throw new ApiError(404, "Course not found.");
        assertCourseOwner(course, actorId);
        if (has(course, "rosterFinalizedAt")) return course;
        if (studentIds(course).size() == 0) {
            throw new ApiError(400, "Add at least one student before posting the register.");
        }
        put(course, "rosterFinalizedAt", nowIso());
        reg.bump();
        return course;
    }

    static String nextStudentId(JsonObject doc) {
        int max = 0;
        for (JsonElement element : arr(doc, "students")) {
            String value = textOr(element.getAsJsonObject(), "id", "");
            if (value.matches("s\\d+")) max = Math.max(max, Integer.parseInt(value.substring(1)));
        }
        int next = max + 1;
        while (studentRow(doc, "s" + next) != null) next++;
        return "s" + next;
    }

    public static JsonObject importRoster(Register reg, String courseId, JsonArray entries, String actorId)
            throws ApiError {
        JsonObject doc = reg.doc();
        JsonObject course = courseRow(doc, courseId);
        if (course == null) throw new ApiError(404, "Course not found.");
        assertCourseOwner(course, actorId);
        if (has(course, "rosterFinalizedAt")) throw new ApiError(409, "The register is final and cannot be changed.");

        JsonArray added = new JsonArray();
        JsonArray already = new JsonArray();
        JsonArray invalid = new JsonArray();
        Set<String> seen = new HashSet<>();
        JsonArray students = arr(doc, "students");
        JsonArray roster = studentIds(course);

        for (JsonElement element : entries == null ? new JsonArray() : entries) {
            if (!element.isJsonObject()) {
                invalid.add(element);
                continue;
            }
            JsonObject entry = element.getAsJsonObject();
            String regNo = textOr(entry, "regNo", "").trim();
            String name = textOr(entry, "name", "").trim().replaceAll("\\s+", " ");
            if (regNo.isEmpty() || name.isEmpty()) {
                invalid.add(entry);
                continue;
            }
            String key = regNo.toUpperCase(Locale.US);
            if (!seen.add(key)) continue;

            JsonObject student = findByUpperReg(students, key);
            if (student != null) {
                put(student, "name", name);
            } else {
                student = new JsonObject();
                put(student, "id", nextStudentId(doc));
                put(student, "regNo", regNo);
                put(student, "name", name);
                put(student, "email", "");
                put(student, "program", textOr(course, "department", "Imported"));
                put(student, "year", 1);
                put(student, "phone", "");
                students.add(student);
            }

            String studentId = text(student, "id");
            boolean present = false;
            for (JsonElement rosterEntry : roster) {
                if (studentId.equals(rosterEntry.getAsString())) {
                    present = true;
                    break;
                }
            }
            if (present) already.add(student);
            else {
                roster.add(studentId);
                added.add(student);
            }
        }

        reg.bump();
        JsonObject result = new JsonObject();
        result.add("added", added);
        result.add("already", already);
        result.add("invalid", invalid);
        return result;
    }

    static JsonObject findByUpperReg(JsonArray students, String upperRegNo) {
        for (JsonElement element : students) {
            JsonObject row = element.getAsJsonObject();
            String regNo = textOr(row, "regNo", "");
            if (regNo.toUpperCase(Locale.US).equals(upperRegNo)) return row;
        }
        return null;
    }

    public static JsonObject setCourseVenue(Register reg, String courseId, Double lat, Double lng,
                                            Double accuracy, Double radius, String actorId) throws ApiError {
        JsonObject doc = reg.doc();
        JsonObject course = courseRow(doc, courseId);
        if (course == null) throw new ApiError(404, "Course not found.");
        assertCourseOwner(course, actorId);
        if (has(course, "rosterFinalizedAt")) throw new ApiError(409, "This class is final for the semester.");

        if (lat == null || lng == null || Double.isNaN(lat) || Double.isNaN(lng)
                || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new ApiError(400, "The GPS fix did not contain valid coordinates.");
        }

        int fence = clamp(20, 200, radius == null ? 50 : (int) Math.round(radius));
        String hallId = "venue-" + text(course, "id");
        JsonObject hall = hallRow(doc, hallId);
        if (hall == null) {
            hall = new JsonObject();
            put(hall, "id", hallId);
            put(hall, "name", textOr(course, "code", "Class") + " classroom");
            put(hall, "building", "Captured venue");
            put(hall, "lat", lat);
            put(hall, "lng", lng);
            put(hall, "radius", fence);
            arr(doc, "halls").add(hall);
        } else {
            put(hall, "lat", lat);
            put(hall, "lng", lng);
            put(hall, "radius", fence);
        }

        put(course, "hallId", hallId);
        put(course, "venueCapturedAt", nowIso());
        put(course, "venueAccuracy", accuracy == null ? null : (int) Math.round(accuracy));
        reg.bump();
        return hall;
    }

    public static JsonObject reset(Register reg) {
        reg.resetToSeed();
        return reg.doc();
    }
}
