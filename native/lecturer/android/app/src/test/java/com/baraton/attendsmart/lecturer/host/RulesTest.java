package com.baraton.attendsmart.lecturer.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * The phone host must enforce exactly what the laptop server enforced. These
 * tests run the real seeded semester through the real rules, on the JVM.
 */
public class RulesTest {

    private Register register;
    private JsonObject course;
    private String courseId;
    private double hallLat;
    private double hallLng;
    private String studentA;
    private String studentB;

    @Before
    public void setUp() throws Exception {
        Path seedPath = java.nio.file.Paths.get("src/main/assets/host-seed.json");
        String seed = new String(Files.readAllBytes(seedPath), StandardCharsets.UTF_8);
        File dir = Files.createTempDirectory("attendance-register").toFile();
        register = Register.bootstrap(seed, dir);

        JsonObject doc = register.doc();
        for (JsonElement element : doc.getAsJsonArray("courses")) {
            JsonObject candidate = element.getAsJsonObject();
            JsonObject hall = Rules.hallRow(doc, Rules.text(candidate, "hallId"));
            if (hall == null) continue;
            Double lat = Rules.num(hall, "lat");
            Double lng = Rules.num(hall, "lng");
            if (lat == null || lng == null || lat == 0) continue;
            if (candidate.getAsJsonArray("studentIds").size() < 2) continue;
            course = candidate;
            courseId = Rules.text(candidate, "id");
            hallLat = lat;
            hallLng = lng;
            studentA = candidate.getAsJsonArray("studentIds").get(0).getAsString();
            studentB = candidate.getAsJsonArray("studentIds").get(1).getAsString();
            break;
        }
        assertNotNull("seed must contain a scheduled course with a hall fix", course);
    }

    private JsonObject openWindow() throws Exception {
        return Rules.startSession(register, courseId, Rules.text(course, "lecturerId"), 10,
                hallLat, hallLng, 6d, 30d);
    }

    @Test
    public void checkInSucceedsInsideTheFenceAndIsRecordedOnce() throws Exception {
        JsonObject session = openWindow();
        assertEquals("active", Rules.text(session, "status"));
        String code = Rules.text(session, "code");
        assertEquals(4, code.length());

        JsonObject posted = Rules.checkIn(register, code, studentA, "dev-a",
                hallLat + 0.00005, hallLng, 5d, "code");
        assertTrue("inside 30 m must be accepted", posted.get("ok").getAsBoolean());
        assertEquals("present", Rules.text(posted.getAsJsonObject("record"), "status"));

        JsonObject again = Rules.checkIn(register, code, studentA, "dev-a",
                hallLat + 0.00005, hallLng, 5d, "code");
        assertFalse("a posted record cannot be posted twice", again.get("ok").getAsBoolean());
        assertEquals("duplicate", Rules.text(again, "step"));
        assertNotNull(again.getAsJsonObject("record"));
    }

    @Test
    public void wrongCodeIsRefusedBeforeAnythingIsWritten() throws Exception {
        openWindow();
        int before = register.doc().getAsJsonArray("attendance").size();

        JsonObject result = Rules.checkIn(register, "0000", studentA, "dev-a",
                hallLat, hallLng, 5d, "code");

        assertFalse(result.get("ok").getAsBoolean());
        assertEquals("code", Rules.text(result, "step"));
        assertEquals("a refused check-in writes nothing", before,
                register.doc().getAsJsonArray("attendance").size());
    }

    @Test
    public void correctCodeFarFromTheHallIsRefused() throws Exception {
        String code = Rules.text(openWindow(), "code");
        // ~1.1 km away: the code is right, the location is not.
        JsonObject result = Rules.checkIn(register, code, studentA, "dev-a",
                hallLat + 0.01, hallLng, 5d, "code");

        assertFalse(result.get("ok").getAsBoolean());
        assertEquals("gps", Rules.text(result, "step"));
        assertTrue(result.get("distanceM").getAsInt() > 30);
    }

    @Test
    public void studentOutsideTheRosterIsRefusedAndLogged() throws Exception {
        String code = Rules.text(openWindow(), "code");
        String outsider = null;
        for (JsonElement element : register.doc().getAsJsonArray("students")) {
            String id = Rules.text(element.getAsJsonObject(), "id");
            if (!Rules.enrolled(course, id)) {
                outsider = id;
                break;
            }
        }
        assertNotNull(outsider);
        int events = register.doc().getAsJsonArray("securityEvents").size();

        JsonObject result = Rules.checkIn(register, code, outsider, "dev-x",
                hallLat, hallLng, 5d, "code");

        assertFalse(result.get("ok").getAsBoolean());
        assertEquals("enrolled", Rules.text(result, "step"));
        assertEquals("the attempt is recorded for the lecturer", events + 1,
                register.doc().getAsJsonArray("securityEvents").size());
    }

    @Test
    public void onePostPerClassPerDaySurvivesReopeningTheWindow() throws Exception {
        JsonObject first = openWindow();
        String code = Rules.text(first, "code");
        // Check in on time, then the lecturer closes and reopens the same unit.
        JsonObject posted = Rules.checkIn(register, code, studentA, "dev-a", hallLat, hallLng, 5d, "code");
        assertTrue(posted.get("ok").getAsBoolean());

        Rules.endSession(register, Rules.text(first, "id"), Rules.text(course, "lecturerId"));
        JsonObject second = openWindow();
        assertFalse("a reopened window must be a new session",
                Rules.text(first, "id").equals(Rules.text(second, "id")));

        JsonObject retry = Rules.checkIn(register, Rules.text(second, "code"), studentA, "dev-a",
                hallLat, hallLng, 5d, "code");
        assertFalse("same unit, same day: refused", retry.get("ok").getAsBoolean());
        assertEquals("duplicate", Rules.text(retry, "step"));

        // A different student in the same reopened window is unaffected.
        JsonObject other = Rules.checkIn(register, Rules.text(second, "code"), studentB, "dev-b",
                hallLat, hallLng, 5d, "code");
        assertTrue(other.get("ok").getAsBoolean());
    }

    @Test
    public void deviceIsBoundToTheFirstStudentWhoPosts() throws Exception {
        String code = Rules.text(openWindow(), "code");
        assertTrue(Rules.checkIn(register, code, studentA, "shared-phone", hallLat, hallLng, 5d, "code")
                .get("ok").getAsBoolean());

        JsonObject stolen = Rules.checkIn(register, code, studentB, "shared-phone", hallLat, hallLng, 5d, "code");
        assertFalse(stolen.get("ok").getAsBoolean());
        assertEquals("identity", Rules.text(stolen, "step"));
    }

    @Test
    public void registerSurvivesRestartAndRevisionMoves() throws Exception {
        File directory = Files.createTempDirectory("attendance-restart").toFile();
        java.nio.file.Path seedPath = java.nio.file.Paths.get("src/main/assets/host-seed.json");
        String seed = new String(Files.readAllBytes(seedPath), StandardCharsets.UTF_8);

        Register first = Register.bootstrap(seed, directory);
        int openingRevision = first.revision();
        String before = first.stateJson();

        JsonObject session = Rules.startSession(first, courseId, Rules.text(course, "lecturerId"), 10,
                hallLat, hallLng, 6d, 30d);
        Rules.checkIn(first, Rules.text(session, "code"), studentA, "dev-a", hallLat, hallLng, 5d, "code");

        assertTrue("revision must move", first.revision() > openingRevision);
        assertFalse("the cached snapshot must be rebuilt", before.equals(first.stateJson()));
        first.flush();

        Register reopened = Register.bootstrap(seed, directory);
        assertEquals("the posted record is on disk", first.revision(), reopened.revision());
        JsonArray attendance = reopened.doc().getAsJsonArray("attendance");
        boolean found = false;
        for (JsonElement element : attendance) {
            if (studentA.equals(Rules.text(element.getAsJsonObject(), "studentId"))
                    && Rules.text(session, "id").equals(Rules.text(element.getAsJsonObject(), "sessionId"))) {
                found = true;
            }
        }
        assertTrue("the check-in was persisted", found);
    }

    @Test
    public void expiredWindowRefusesFurtherPosts() throws Exception {
        JsonObject session = openWindow();
        Rules.put(session, "endsAt", Rules.iso(System.currentTimeMillis() - 1000));
        String code = Rules.text(session, "code");

        JsonObject result = Rules.checkIn(register, code, studentA, "dev-a", hallLat, hallLng, 5d, "code");

        assertFalse("a window that ran out cannot accept posts", result.get("ok").getAsBoolean());
        assertEquals("ended", Rules.text(session, "status"));
    }
}
