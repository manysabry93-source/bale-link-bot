import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

function ensureFile() {
  const dir = path.dirname(config.channelsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(config.channelsFile)) fs.writeFileSync(config.channelsFile, '[]');
}

export function listChannels() {
  ensureFile();
  return JSON.parse(fs.readFileSync(config.channelsFile, 'utf8'));
}

export function addChannel(name, platform, chatId) {
  const channels = listChannels();
  if (channels.some((c) => c.name === name)) throw new Error(`Channel "${name}" already exists`);
  channels.push({ name, platform, chatId });
  fs.writeFileSync(config.channelsFile, JSON.stringify(channels, null, 2));
}

export function removeChannel(name) {
  const channels = listChannels().filter((c) => c.name !== name);
  fs.writeFileSync(config.channelsFile, JSON.stringify(channels, null, 2));
}
