export { HhClient, HhHttpError, HhCircuitOpenError } from './client.js';
export { mapVacancyToRawJob } from './mapper.js';
export { HH_MAX_RESULTS_DEPTH, shouldSplit, splitTimeSlice, createTimeSliceWindow, buildSegmentKey } from './segments.js';
export type { TimeSlice } from './segments.js';
export type {
  HhSearchResponse,
  HhSearchVacancyItem,
  HhVacancyDetail,
  HhSalary,
  HhSearchParams,
  HhProfessionalRolesResponse,
  HhProfessionalRole,
  HhProfessionalRoleCategory,
} from './types.js';
