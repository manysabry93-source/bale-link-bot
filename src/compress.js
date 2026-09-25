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

/**
 * Compresses a video buffer down to roughly targetBytes, by computing a
 * video bitrate from the duration and re-encoding with ffmpeg (H.264 + AAC).
 * Returns the compressed buffer. Only makes sense for actual video files.
 */
export async function compressVideo(buffer, targetBytes) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(6).toString('hex');
  const inputPath = path.join(tmpDir, `relay-in-${id}.mp4`);
  const outputPath = path.join(tmpDir, `relay-out-${id}.mp4`);

  await fs.writeFile(inputPath, buffer);

  try {
    const duration = await getDurationSeconds(inputPath);

    const audioBitrate = 96_000; // 96 kbps audio, bits/sec
    // Leave ~8% safety margin below the target size.
    const totalBitrate = Math.floor((targetBytes * 8 * 0.92) / duration);
    const videoBitrate = Math.max(totalBitrate - audioBitrate, 100_000); // floor at 100kbps video

    console.log(
      `Compressing: duration=${duration.toFixed(1)}s target=${targetBytes} bytes -> videoBitrate=${Math.floor(videoBitrate / 1000)}kbps`
    );

    await run('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-b:v', String(videoBitrate),
      '-maxrate', String(videoBitrate),
      '-bufsize', String(videoBitrate * 2),
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-b:a', String(audioBitrate),
      '-movflags', '+faststart',
      outputPath,
    ]);

    const compressed = await fs.readFile(outputPath);
    console.log(`Compression done: ${buffer.length} -> ${compressed.length} bytes`);
    return compressed;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
