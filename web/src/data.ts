/**
 * The dashboard's data seam. Every view reads and writes through this module,
 * and it resolves to src/api.ts — the only module that touches the network.
 *
 * It exists so that a view never names an endpoint and never sees a URL. There
 * is exactly one implementation behind it; nothing here branches at runtime.
 */
export {
  createRun,
  getBrief,
  getHealth,
  getRun,
  getRunResults,
  listRecordings,
  recordingVideoUrl,
  saveBrief,
  startComprehension,
  subscribeToComprehension,
  subscribeToRun,
} from './api'
