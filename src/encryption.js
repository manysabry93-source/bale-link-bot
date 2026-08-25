import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const key = Buffer.from(config.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY_HEX must be a 64-char hex string (32 bytes).');
  }
  return key;
}

export async function encryptFile(inputPath, outputPath) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);
  output.write(iv);
  await pipeline(input, cipher, output, { end: false });
  output.write(cipher.getAuthTag());
  await new Promise((resolve, reject) => {
    output.end(resolve);
    output.on('error', reject);
  });
}

export async function decryptFile(inputPath, outputPath) {
  const key = getKey();
  const { size } = fs.statSync(inputPath);
  const fd = fs.openSync(inputPath, 'r');
  const ivBuf = Buffer.alloc(IV_LENGTH);
  fs.readSync(fd, ivBuf, 0, IV_LENGTH, 0);
  const tagBuf = Buffer.alloc(TAG_LENGTH);
  fs.readSync(fd, tagBuf, 0, TAG_LENGTH, size - TAG_LENGTH);
  fs.closeSync(fd);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(tagBuf);
  const ciphertextEnd = size - TAG_LENGTH - 1;
  const input = fs.createReadStream(inputPath, { start: IV_LENGTH, end: ciphertextEnd });
  const output = fs.createWriteStream(outputPath);
  await pipeline(input, decipher, output);
}
