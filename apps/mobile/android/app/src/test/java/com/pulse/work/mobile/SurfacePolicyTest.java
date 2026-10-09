package com.pulse.work.mobile;
import static org.junit.Assert.*;
import org.junit.Test;
public class SurfacePolicyTest {
    @Test public void cacheExpiresAndNeverSurvivesRebootOrClockRegression() {
        assertTrue(SurfacePolicy.fresh(4, 4, 1000, 1001));
        assertFalse(SurfacePolicy.fresh(4, 4, 1000, 301000));
        assertFalse(SurfacePolicy.fresh(4, 5, 1000, 1001));
        assertFalse(SurfacePolicy.fresh(4, 4, 1000, 999));
        assertFalse(SurfacePolicy.fresh(4, 4, -1, 1000));
    }
    @Test public void onlyCurrentEnabledStatesOfferSafeConfirmation() {
        assertEquals("check-in", SurfacePolicy.primary("out", true));
        assertEquals("check-in", SurfacePolicy.primary("done", true));
        assertEquals("check-out", SurfacePolicy.primary("in", true));
        assertEquals("check-out", SurfacePolicy.primary("break", true));
        for (String state : new String[]{"out", "in", "break", "holiday", "off", "signed-out", "unknown"})
            assertEquals("open", SurfacePolicy.primary(state, false));
        assertEquals("open", SurfacePolicy.primary("holiday", true));
        assertEquals("open", SurfacePolicy.primary("unknown", true));
    }
}
