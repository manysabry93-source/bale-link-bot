import { PassThrough } from 'node:stream';

/**
 * Splits one readable stream into two independent readable streams carrying
 * the same bytes, so a single incoming download can be piped into two
 * outgoing uploads (Bale + Rubika) at once, in memory only - nothing touches disk.
 */
export function teeStream(source) {
  const a = new PassThrough();
  const b = new PassThrough();

  source.on('data', (chunk) => {
    a.write(chunk);
    b.write(chunk);
  });
  source.on('end', () => {
    a.end();
    b.end();
  });
  source.on('error', (err) => {
    a.destroy(err);
    b.destroy(err);
  });

  return [a, b];
}
