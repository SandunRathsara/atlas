import type { OpenCodeHandoffService } from "./opencode.ts";
import type { PreparationService } from "./preparation.ts";

export const UPDATE_PAUSE_TIMEOUT_MS = 5 * 60 * 1_000;

type UpdatePauseOptions = {
  preparation: Pick<PreparationService, "pauseForUpdate" | "resumeFromUpdate">;
  openCode: Pick<OpenCodeHandoffService, "pauseForUpdate" | "resumeFromUpdate">;
  timeoutMs?: number;
};

export type UpdatePauseOutcome =
  | { status: "paused"; resume: () => boolean }
  | { status: "timed_out"; reason: "safe_checkpoint_timeout" };

export const createUpdatePauseCoordinator = (options: UpdatePauseOptions) => {
  const timeoutMs = options.timeoutMs ?? UPDATE_PAUSE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Update pause timeout must be a positive safe integer");

  let generation = 0;
  let current: { generation: number; state: "pausing" | "paused"; result: Promise<UpdatePauseOutcome> } | undefined;

  const resume = (expectedGeneration: number) => {
    if (current?.generation !== expectedGeneration) return false;
    options.preparation.resumeFromUpdate();
    options.openCode.resumeFromUpdate();
    current = undefined;
    return true;
  };

  const pause = () => {
    if (current) return current.result;

    const pauseGeneration = ++generation;
    const preparation = options.preparation.pauseForUpdate();
    const handoff = options.openCode.pauseForUpdate();
    let timer: ReturnType<typeof setTimeout>;
    const result = new Promise<UpdatePauseOutcome>((resolve) => {
      timer = setTimeout(() => {
        resume(pauseGeneration);
        resolve({ status: "timed_out", reason: "safe_checkpoint_timeout" });
      }, timeoutMs);
      timer.unref?.();

      void Promise.all([preparation, handoff]).then(() => {
        if (current?.generation !== pauseGeneration) return;
        clearTimeout(timer);
        current.state = "paused";
        resolve({ status: "paused", resume: () => resume(pauseGeneration) });
      });
    });
    current = { generation: pauseGeneration, state: "pausing", result };
    return result;
  };

  return {
    pause,
    state: () => current?.state ?? "active" as const,
  };
};

export type UpdatePauseCoordinator = ReturnType<typeof createUpdatePauseCoordinator>;
