import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited with code ${code}: ${(stderr || stdout).slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Splits any file (PDF, ZIP, etc.) into multiple 7z volumes, each under
 * maxBytes. This is a real archive split - no re-encoding, no quality loss.
 * The recipient downloads all parts into the same folder and opens the
 * first one (.001) with 7-Zip; it automatically finds and joins the rest.
 * Returns an array of { buffer, extension } for each volume, in order.
 */
export async function splitFileGeneric(buffer, fileName, maxBytes) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(6).toString('hex');
  const inputPath = path.join(tmpDir, `gsplit-in-${id}-${fileName}`);
  const archiveBase = path.join(tmpDir, `gsplit-out-${id}.7z`);

  await fs.writeFile(inputPath, buffer);

  const cleanupPaths = [inputPath];

  try {
    // -v<size>b sets the volume size in bytes.
    await run('7z', ['a', `-v${maxBytes}b`, archiveBase, inputPath]);

    const dir = path.dirname(archiveBase);
    const baseName = path.basename(archiveBase);
    const allFiles = await fs.readdir(dir);
    const volumeFiles = allFiles
      .filter((f) => f.startsWith(baseName + '.'))
      .sort(); // .001, .002, ... sorts correctly as strings of equal length

    if (volumeFiles.length === 0) {
      throw new Error('7z produced no volume files');
    }

    cleanupPaths.push(...volumeFiles.map((f) => path.join(dir, f)));

    const parts = [];
    for (const f of volumeFiles) {
      const ext = f.slice(baseName.length); // e.g. ".001"
      const buf = await fs.readFile(path.join(dir, f));
      parts.push({ buffer: buf, extension: ext });
    }

    console.log(`Split into ${parts.length} archive volume(s): ${parts.map((p) => p.buffer.length).join(', ')} bytes`);
    return parts;
  } finally {
    for (const p of cleanupPaths) {
      await fs.unlink(p).catch(() => {});
    }
  }
}
