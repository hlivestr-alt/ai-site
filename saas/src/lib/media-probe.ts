import http from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "./core";
import type { ObjectHead, ObjectStorage } from "./storage";

export const MEDIA_VALIDATION_VERSION = 1;
const BYTE_BUDGET = 32 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
export type VideoProbe = { durationSeconds: number; width: number; height: number; hasAudio: boolean };

// ffprobe sees only a random, loopback-only URL. The proxy enforces a total
// read budget, timeout and immutable ETag; no S3 signature enters child args/logs.
export async function probeVideo(storage: Pick<ObjectStorage, "readRange">, key: string, head: ObjectHead, requireAudio = false): Promise<VideoProbe> {
  const path = `/${randomBytes(24).toString("hex")}.mp4`;
  const controller = new AbortController();
  let readBytes = 0, requests = 0, exhausted = false, storageUnavailable = false;
  const server = http.createServer(async (request, response) => {
    if (request.url !== path || !["HEAD", "GET"].includes(request.method || "") || ++requests > 128) { response.writeHead(404).end(); return; }
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", "video/mp4");
    if (request.method === "HEAD") { response.setHeader("Content-Length", head.byteSize); response.writeHead(200).end(); return; }
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "bytes=0-");
    const start = match ? Number(match[1]) : -1;
    const end = Math.min(head.byteSize - 1, match?.[2] ? Number(match[2]) : head.byteSize - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) { response.writeHead(416).end(); return; }
    response.setHeader("Content-Range", `bytes ${start}-${end}/${head.byteSize}`);
    response.setHeader("Content-Length", end - start + 1);
    const rangeAbort = new AbortController();
    const abortRange = () => rangeAbort.abort();
    response.on("close", abortRange);
    controller.signal.addEventListener("abort", abortRange, { once: true });
    try {
      const stream = await storage.readRange(key, start, end, head.etag, rangeAbort.signal);
      response.writeHead(206);
      for await (const chunk of stream) {
        if (response.destroyed || rangeAbort.signal.aborted) break;
        readBytes += chunk.length;
        if (readBytes > BYTE_BUDGET) { exhausted = true; controller.abort(); break; }
        if (!response.write(chunk)) await new Promise<void>(resolve => { const done = () => { response.off("drain", done); response.off("close", done); resolve(); }; response.once("drain", done); response.once("close", done); });
      }
      response.end();
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (!controller.signal.aborted && !rangeAbort.signal.aborted && status !== 404 && status !== 412) storageUnavailable = true;
      response.destroy();
    }
    finally { response.off("close", abortRange); controller.signal.removeEventListener("abort", abortRange); rangeAbort.abort(); }
  });
  server.requestTimeout = TIMEOUT_MS;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new AppError(503, "Media validation is temporarily unavailable.");
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const result = await promisify(execFile)(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-max_alloc", "33554432", "-threads", "1", "-protocol_whitelist", "http,tcp",
      "-rw_timeout", "5000000", "-probesize", "4194304", "-analyzeduration", "3000000",
      "-f", "mov", "-enable_drefs", "0", "-read_intervals", "%+#24", "-show_frames", "-show_streams", "-show_format",
      "-show_entries", "frame=media_type,width,height:stream=codec_type,codec_name,width,height:format=format_name,duration",
      "-of", "json", `http://127.0.0.1:${address.port}${path}`,
    ], { timeout: TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true, signal: controller.signal });
    const parsed = JSON.parse(result.stdout);
    const video = parsed.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
    const durationSeconds = Number(parsed.format?.duration), width = Number(video?.width), height = Number(video?.height);
    const hasAudio = parsed.streams?.some((s: { codec_type: string }) => s.codec_type === "audio") === true;
    if (exhausted || !video?.codec_name || !parsed.format?.format_name?.split(",").includes("mp4") || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds >= 86400 || !Number.isInteger(width) || width <= 0 || width > 16384 || !Number.isInteger(height) || height <= 0 || height > 16384 || !parsed.frames?.some((f: { media_type: string; width: number; height: number }) => f.media_type === "video" && f.width === width && f.height === height) || requireAudio && !hasAudio) throw new AppError(422, "Select a valid, decodable MP4 video with the required media tracks.");
    return { durationSeconds, width, height, hasAudio };
  } catch (error) {
    if (error instanceof AppError) throw error;
    // A temporary transfer outage must not permanently classify valid media as
    // corrupt or make its failed-staging object eligible for retention cleanup.
    if (storageUnavailable) throw new AppError(503, "Media validation is temporarily unavailable.");
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new AppError(503, "Media validation is temporarily unavailable.");
    throw new AppError(422, "Video could not be decoded safely within the validation limits.");
  } finally {
    clearTimeout(timer); controller.abort(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
