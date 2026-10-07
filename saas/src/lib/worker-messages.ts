const stages: Record<string, string> = {
  PREPARING_EDIT: "Preparing your edit.", RENDERING_VARIATION: "Rendering your variation.",
  UPLOADING_VARIATION: "Saving your variation.", FINALIZING_VARIATION: "Finishing your variation.",
  RUNNING: "Processing your video.", STEP: "Processing task.",
  DOWNLOADING_SOURCE: "Downloading your source video.", VERIFYING_SOURCE: "Checking your source video.",
  TRANSCRIBING: "Transcribing your video.", ANALYZING_TRANSCRIPT: "Finding useful moments.",
  SELECTING_MOMENTS: "Selecting clips.", RENDERING: "Preparing your clips.",
  UPLOADING_RESULTS: "Saving your clips.", FINALIZING: "Finishing your clips.",
  WAITING_FOR_WORKER: "Waiting for processing to start.", RETRY_SCHEDULED: "Processing was interrupted. A retry is scheduled.",
  COMPLETE: "Your clips are ready.", CANCELLED: "Cancelled.", FAILED: "Your clips could not be completed.",
};
const failures: Record<string, { message: string; retry: boolean }> = {
  VARIATION_INPUT_INVALID: {message:"Saved editing data could not be verified. Please try another clip.",retry:false},
  SOURCE_DOWNLOAD_FAILED: { message: "The source video could not be downloaded. Retrying.", retry: true },
  TRANSCRIPTION_MODEL_UNAVAILABLE: { message: "Video transcription is temporarily unavailable.", retry: true },
  ANALYZER_UNAVAILABLE: { message: "Clip analysis is temporarily unavailable.", retry: true },
  ANALYZER_AUTH_FAILED: { message: "Clip analysis is temporarily unavailable.", retry: false },
  WORKER_INTERRUPTED: { message: "Processing was interrupted. Retrying your video.", retry: true },
  LOCAL_PROCESS_FAILED: { message: "Video processing was interrupted. Retrying.", retry: true },
  PROCESS_TIMEOUT: { message: "Video processing took longer than expected. Retrying.", retry: true },
  OUTPUT_UPLOAD_FAILED: { message: "Your clips could not be saved. Retrying.", retry: true },
  WORKER_DISK_SPACE_LOW: { message: "Video processing is temporarily unavailable.", retry: true },
  CLIPPER_OPERATION_FAILED: { message: "Video processing is temporarily unavailable. Please try again.", retry: true },
  SOURCE_INVALID: { message: "The source video could not be read. Upload a valid MP4 video.", retry: false },
  SOURCE_AUDIO_REQUIRED: { message: "The source video needs an audio track.", retry: false },
  SOURCE_CHECKSUM_MISMATCH: { message: "The source video could not be verified. Upload it again.", retry: false },
  SOURCE_SIZE_MISMATCH: { message: "The source video could not be verified. Upload it again.", retry: false },
  SOURCE_TOO_LARGE: { message: "The source video exceeds the supported limit.", retry: false },
  TRANSCRIPT_EMPTY: { message: "No speech was found in this video.", retry: false },
  TRANSCRIPT_INVALID: { message: "The video transcript could not be prepared.", retry: false },
  TRANSCRIPT_SEGMENT_TOO_LARGE: { message: "The video transcript could not be prepared.", retry: false },
  ANALYZER_INVALID_RESPONSE: { message: "Clip analysis could not be completed. Please try again.", retry: false },
  ANALYZER_INVALID_CANDIDATES: { message: "Clip analysis could not be completed. Please try again.", retry: false },
  NO_VALID_MOMENTS: { message: "No suitable clips were found with these settings.", retry: false },
  PLAN_INVALID: { message: "The clip plan could not be verified. Please try again.", retry: false },
  RENDER_INVALID: { message: "The clips could not be prepared. Please try again.", retry: false },
  INPUT_UNAVAILABLE: { message: "Required source or reference media is unavailable.", retry: false },
  LEASE_EXPIRED: { message: "Processing was interrupted. A retry is scheduled.", retry: true },
  LEASE_FENCED: { message: "Processing was interrupted. A retry is scheduled.", retry: true },
  CANCELLED: { message: "Cancelled.", retry: false },
  FIXTURE_ERROR: { message: "Task processing was interrupted.", retry: true },
};

export function customerWorkerStage(raw: string) {
  const code = raw.toUpperCase();
  return code in stages ? { stage: code.toLowerCase(), message: stages[code] } : { stage: "running", message: stages.RUNNING };
}
export function customerWorkerFailure(raw: string) {
  const known = Object.hasOwn(failures, raw);
  const code = known ? raw : "CLIPPER_OPERATION_FAILED";
  return { code, known, ...failures[code] };
}
export function clipperCustomerMessages(job: { status: string; progress_stage: string; error_code?: string | null; attempt_count?: number; max_attempts?: number }) {
  const progress = customerWorkerStage(job.progress_stage);
  let errorMessage: string | null = null;
  if (job.status === "FAILED") errorMessage = job.attempt_count && job.max_attempts && job.attempt_count >= job.max_attempts ? "The clips could not be completed after several attempts. Please try again." : customerWorkerFailure(job.error_code || "").message.replace(/ Retrying\.?$/, " Please try again.");
  return { ...progress, errorMessage };
}
