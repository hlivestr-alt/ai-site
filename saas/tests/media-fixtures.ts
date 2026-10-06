import { readFile } from 'node:fs/promises';

// A real decodable audiovisual MP4 followed by one valid padding box. The
// large multipart regression tests exercise range probing without fake media.
export async function paddedVideoFirstPart(totalBytes: number, partBytes: number) {
  const video = await readFile('tests/fixtures/clipper-speech.mp4');
  if (video.length + 8 > partBytes || totalBytes <= partBytes || totalBytes - video.length > 0xffffffff) throw new Error('Invalid multipart fixture dimensions');
  const first = Buffer.alloc(partBytes);
  video.copy(first);
  first.writeUInt32BE(totalBytes - video.length, video.length);
  first.write('free', video.length + 4);
  return first;
}
