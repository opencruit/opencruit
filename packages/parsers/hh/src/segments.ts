export const HH_MAX_RESULTS_DEPTH = 2000;

export interface TimeSlice {
  dateFromIso: string;
  dateToIso: string;
}

export function shouldSplit(found: number): boolean {
  return found > HH_MAX_RESULTS_DEPTH;
}

export function splitTimeSlice(slice: TimeSlice): [TimeSlice, TimeSlice] {
  const startMs = new Date(slice.dateFromIso).getTime();
  const endMs = new Date(slice.dateToIso).getTime();
  const midMs = startMs + Math.floor((endMs - startMs) / 2);

  const left: TimeSlice = {
    dateFromIso: new Date(startMs).toISOString(),
    dateToIso: new Date(midMs).toISOString(),
  };

  const right: TimeSlice = {
    dateFromIso: new Date(midMs).toISOString(),
    dateToIso: new Date(endMs).toISOString(),
  };

  return [left, right];
}

export function createTimeSliceWindow(now: Date, lookbackMinutes: number): TimeSlice {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - lookbackMinutes * 60 * 1000);

  return {
    dateFromIso: start.toISOString(),
    dateToIso: end.toISOString(),
  };
}

export function buildSegmentKey(professionalRole: string, slice: TimeSlice): string {
  return `role:${professionalRole}:${slice.dateFromIso}:${slice.dateToIso}`;
}
