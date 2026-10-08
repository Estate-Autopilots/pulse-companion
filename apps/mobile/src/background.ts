// Runs when the operating system wakes Pulse for a region event (arriving at or leaving an office or confirmed shoot
// site). Defined at start-up, before the app renders, as the OS may start Pulse just for this.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { init, signedIn } from './client';
import { GEOFENCE_TASK, onRegion } from './companion';

type RegionEvent = { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

TaskManager.defineTask<RegionEvent>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data?.region?.identifier) return;
  try {
    if (!signedIn() && !(await init())) return;
    await onRegion(data.eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit', data.region.identifier);
  } catch { /* the next region event or app open tries again */ }
});
