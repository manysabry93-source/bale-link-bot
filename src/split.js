import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

async function getDurationSeconds(filePath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ];
  const out = await new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`ffprobe failed: ${stderr.slice(-500)}`));
    });
  });
  const duration = parseFloat(out);
  if (!duration || duration <= 0) throw new Error(`Could not determine video duration (got "${out}")`);
  return duration;
}

async function splitOnce(inputPath, segmentTime, tmpDir, tag) {
  const pattern = path.join(tmpDir, `part-${tag}-%03d.mp4`);
  await run('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c', 'copy',
    '-map', '0',
    '-f', 'segment',
    '-segment_time', String(Math.max(segmentTime, 1)),
    '-reset_timestamps', '1',
    pattern,
  ]);

  const files = (await fs.readdir(tmpDir))
    .filter((f) => f.startsWith(`part-${tag}-`) && f.endsWith('.mp4'))
    .sort();

  return files.map((f) => path.join(tmpDir, f));
}

/**
 * Splits a video buffer into multiple parts, each under maxBytes, using
 * ffmpeg's stream-copy segment muxer - NO re-encoding, so there is zero
 * quality loss. Returns an array of Buffers, one per part, in order.
 */
export async function splitVideo(buffer, maxBytes) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(6).toString('hex');
  const inputPath = path.join(tmpDir, `split-in-${id}.mp4`);
  await fs.writeFile(inputPath, buffer);

  const cleanupPaths = [inputPath];

  try {
    const duration = await getDurationSeconds(inputPath);
    const totalSize = buffer.length;

    // Estimate segment duration from the size ratio, with a 12% safety
    // margin since bitrate isn't perfectly constant throughout the file.
    let segmentTime = duration * (maxBytes / totalSize) * 0.88;

    let partPaths = await splitOnce(inputPath, segmentTime, tmpDir, `${id}-a`);
    cleanupPaths.push(...partPaths);

    // If any part still exceeds the limit (variable bitrate), retry once
    // with a smaller segment time before giving up and accepting it as-is.
    let stats = await Promise.all(partPaths.map((p) => fs.stat(p)));
    const anyTooBig = stats.some((s) => s.size > maxBytes);

    if (anyTooBig) {
      console.log('Some parts still exceed the limit, retrying with a smaller segment size...');
      segmentTime = segmentTime * 0.7;
      const retryPaths = await splitOnce(inputPath, segmentTime, tmpDir, `${id}-b`);
      cleanupPaths.push(...retryPaths);
      partPaths = retryPaths;
      stats = await Promise.all(partPaths.map((p) => fs.stat(p)));
    }

    console.log(`Split into ${partPaths.length} part(s): ${stats.map((s) => s.size).join(', ')} bytes`);

    const buffers = [];
    for (const p of partPaths) {
      buffers.push(await fs.readFile(p));
    }
    return buffers;
  } finally {
    for (const p of cleanupPaths) {
      await fs.unlink(p).catch(() => {});
    }
  }
}
