package com.pulse.work.mobile;

/** Minimal presentation policy. Never projects attendance or runs an independent work timer. */
final class SurfacePolicy {
    static final long FRESH_MS = 5 * 60_000;
    static boolean fresh(long savedBoot, long boot, long savedElapsed, long elapsed) {
        return savedBoot == boot && savedElapsed >= 0 && elapsed >= savedElapsed && elapsed - savedElapsed < FRESH_MS;
    }
    static String primary(String state, boolean enabled) {
        if (!enabled) return "open";
        if ("in".equals(state) || "break".equals(state)) return "check-out";
        if ("out".equals(state) || "done".equals(state)) return "check-in";
        return "open";
    }
    static String title(String state) {
        switch (state) {
            case "in": return "Checked in";
            case "break": return "On a break";
            case "done": return "Checked out";
            case "out": return "Not checked in";
            default: return "Open My desk";
        }
    }
}
