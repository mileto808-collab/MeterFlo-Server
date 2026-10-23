import { AsyncLocalStorage } from "node:async_hooks";
import type { MobileSubmission } from "../shared/mobile-submission-contract";

export const mobileSubmissionContext = new AsyncLocalStorage<MobileSubmission>();

/** Stable media names prevent duplicate files when a pre-commit request is retried. */
export function mobileSubmissionMediaName(type: string, index: number, extension: string, legacy: string) {
  const context = mobileSubmissionContext.getStore();
  return context ? `${type.replace(/[^a-z0-9_-]/gi, "_")}_${context.id}_${index}${extension}` : legacy;
}
