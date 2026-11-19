import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { logger } from '@/ui/logger';

/**
 * System HEIF decoders, tried in order. Both read HEIC/HEIF and write PNG from the output name.
 * `heif-dec` comes with libheif (package libheif-examples or libheif); `magick` is ImageMagick 7
 * built with libheif.
 */
const HEIF_DECODERS: ReadonlyArray<Readonly<{ command: string; args: (input: string, output: string) => string[] }>> = [
  { command: 'heif-dec', args: (input, output) => [input, output] },
  { command: 'magick', args: (input, output) => [input, output] },
];

/** One decode of a phone photo takes well under a second; this only stops a hung tool. */
const DECODE_TIMEOUT_MS = 30_000;

function run(command: string, args: string[]): Promise<'ok' | 'missing' | 'failed'> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: DECODE_TIMEOUT_MS, windowsHide: true }, (error) => {
      if (!error) return resolve('ok');
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve('missing');
      logger.debug(`[sessionMedia] ${command} could not decode a HEIF image: ${error.message}`);
      resolve('failed');
    });
  });
}

/**
 * Decode HEIC/HEIF bytes to PNG with a decoder installed on this machine.
 * Returns null when no decoder is installed or none could decode the bytes.
 */
export async function decodeHeifWithSystemTool(bytes: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'happier-heif-'));
  try {
    const input = join(dir, 'input.heic');
    const output = join(dir, 'output.png');
    await writeFile(input, bytes);
    for (const decoder of HEIF_DECODERS) {
      const result = await run(decoder.command, decoder.args(input, output));
      if (result === 'ok') {
        return await readFile(output).catch(() => null);
      }
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
