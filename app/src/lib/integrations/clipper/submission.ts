/** Mirrors the existing QueueControlRequest shape. No route submits it in Phase 3. */
export type ClipperQueueRequest = { action: "start"; launch_config: { run_mode: "single_video"; pipeline_mode: "full"; variant_mode: "all"; variant_count: 1; max_clips: number; video_path: string } };
export function planClipperJob(sourceName: string, maxClips: number, allowedSources: string[]): ClipperQueueRequest {
  if (!allowedSources.includes(sourceName) || !sourceName || sourceName.includes("/") || sourceName.includes("\\")) throw new Error("Choose a watched source file");
  if (!Number.isInteger(maxClips) || maxClips < 1 || maxClips > 20) throw new Error("Choose 1–20 clips");
  return { action: "start", launch_config: { run_mode: "single_video", pipeline_mode: "full", variant_mode: "all", variant_count: 1, max_clips: maxClips, video_path: sourceName } };
}
