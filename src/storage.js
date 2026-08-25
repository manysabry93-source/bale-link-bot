import fs from 'node:fs';
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { config } from './config.js';

const s3 = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

export async function uploadToR2(localPath, key) {
  const body = fs.createReadStream(localPath);
  const { size } = fs.statSync(localPath);
  await s3.send(new PutObjectCommand({ Bucket: config.r2.bucket, Key: key, Body: body, ContentLength: size }));
}

export async function downloadFromR2(key, destPath) {
  const result = await s3.send(new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }));
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    result.Body.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

export async function deleteFromR2(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }));
}
