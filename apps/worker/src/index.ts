// @nusantara/worker — the draft + outbox pipeline (no port).
//
// The library surface. `main.ts` is the runnable entry point; keeping the two
// apart is what lets a test run one tick against a real database without
// installing signal handlers or reading the environment.

export {
  loadEnvFile,
  loadWorkerConfig,
  WORKER_ENV_KEYS,
  type WorkerConfig,
} from "./config.js";
export { draftPass, type DraftDeps, type DraftPassResult } from "./draft.js";
export { sendPass, type SendDeps, type SendPassResult } from "./send.js";
export { resetPass, type ResetDeps, type ResetPassResult } from "./reset.js";
export { stalePass, type StaleDeps, type StalePassResult } from "./stale.js";
export {
  run,
  tick,
  type RunOptions,
  type TickDeps,
  type TickResult,
} from "./loop.js";
