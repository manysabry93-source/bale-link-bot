import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited with code ${code}: ${(stderr || stdout).slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

async function getPageCount(filePath) {
  const out = await run('qpdf', ['--show-npages', filePath]);
  const n = parseInt(out.trim(), 10);
  if (!n || n <= 0) throw new Error(`Could not determine PDF page count (got "${out}")`);
  return n;
}

async function extractPages(inputPath, outputPath, startPage, endPage) {
  await run('qpdf', [inputPath, '--pages', '.', `${startPage}-${endPage}`, '--', outputPath]);
}

/**
 * Splits a PDF into multiple smaller, independently-openable PDF files,
 * each under maxBytes. No quality loss - pages are copied as-is via qpdf.
 * Returns an array of Buffers, one per part, in page order.
 */
export async function splitPdf(buffer, maxBytes) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(6).toString('hex');
  const inputPath = path.join(tmpDir, `pdfsplit-in-${id}.pdf`);
  await fs.writeFile(inputPath, buffer);

  const cleanupPaths = [inputPath];
  const parts = [];

  try {
    const totalPages = await getPageCount(inputPath);
    const totalSize = buffer.length;
    const avgPageSize = totalSize / totalPages;

    // Initial guess for pages per part, with a 10% safety margin.
    let pagesPerPart = Math.max(1, Math.floor((maxBytes * 0.9) / avgPageSize));

    let currentPage = 1;
    let partIndex = 0;

    while (currentPage <= totalPages) {
      let count = Math.min(pagesPerPart, totalPages - currentPage + 1);
      let endPage = currentPage + count - 1;
      let outputPath = path.join(tmpDir, `pdfsplit-out-${id}-${partIndex}.pdf`);

      await extractPages(inputPath, outputPath, currentPage, endPage);
      let stat = await fs.stat(outputPath);

      // If this part is too big (e.g. pages have large embedded images),
      // shrink the page range until it fits, or we're down to one page.
      while (stat.size > maxBytes && count > 1) {
        count = Math.max(1, Math.floor(count / 2));
        endPage = currentPage + count - 1;
        await fs.unlink(outputPath).catch(() => {});
        await extractPages(inputPath, outputPath, currentPage, endPage);
        stat = await fs.stat(outputPath);
      }

      cleanupPaths.push(outputPath);
      const buf = await fs.readFile(outputPath);
      parts.push(buf);

      console.log(`  PDF part ${partIndex + 1}: pages ${currentPage}-${endPage}, ${buf.length} bytes`);

      currentPage = endPage + 1;
      partIndex++;
    }

    console.log(`Split PDF into ${parts.length} part(s).`);
    return parts;
  } finally {
    for (const p of cleanupPaths) {
      await fs.unlink(p).catch(() => {});
    }
  }
}
