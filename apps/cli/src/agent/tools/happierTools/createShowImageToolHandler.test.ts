import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createShowImageToolHandler } from './createShowImageToolHandler';

async function pngBytes(width: number, height: number): Promise<Buffer> {
  return await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
}

describe('createShowImageToolHandler', () => {
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happier-show-image-'));
    workspace = join(root, 'workspace');
    await mkdir(join(workspace, 'out'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns the image as an MCP image block and a summary for the model', async () => {
    const bytes = await pngBytes(40, 30);
    await writeFile(join(workspace, 'out', 'chart.png'), bytes);
    const showImage = createShowImageToolHandler({ resolveWorkingDirectory: () => workspace });

    const result = await showImage({ path: 'out/chart.png', caption: 'Monthly totals' });

    expect(result).toEqual({
      ok: true,
      result: {
        shown: true,
        path: join(workspace, 'out', 'chart.png'),
        mimeType: 'image/png',
        width: 40,
        height: 30,
        caption: 'Monthly totals',
      },
      content: [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }],
    });
  });

  it('converts a TIFF file to PNG and reports the source type', async () => {
    const tiff = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#808080' } }).tiff().toBuffer();
    await writeFile(join(workspace, 'scan.tiff'), tiff);
    const showImage = createShowImageToolHandler({ resolveWorkingDirectory: () => workspace });

    const result = await showImage({ path: join(workspace, 'scan.tiff') });

    expect(result).toMatchObject({
      ok: true,
      result: { mimeType: 'image/png', sourceMimeType: 'image/tiff', width: 8, height: 6 },
      content: [{ type: 'image', mimeType: 'image/png' }],
    });
  });

  it('keeps the session media access policy: no paths outside the working directory', async () => {
    await writeFile(join(root, 'secret.png'), await pngBytes(4, 4));
    const showImage = createShowImageToolHandler({ resolveWorkingDirectory: () => workspace });

    expect(await showImage({ path: '../secret.png' })).toMatchObject({ ok: false, errorCode: 'image_path_denied' });
    expect(await showImage({ path: join(root, 'secret.png') })).toMatchObject({ ok: false, errorCode: 'image_path_denied' });
  });

  it('rejects links out of the workspace, missing files and files that are not images', async () => {
    await writeFile(join(root, 'outside.png'), await pngBytes(4, 4));
    await symlink(join(root, 'outside.png'), join(workspace, 'link.png'));
    await writeFile(join(workspace, 'notes.txt'), 'not an image');
    const showImage = createShowImageToolHandler({ resolveWorkingDirectory: () => workspace });

    // The path policy resolves the link and finds its target outside the working directory.
    expect(await showImage({ path: 'link.png' })).toMatchObject({ ok: false, errorCode: 'image_path_denied' });
    expect(await showImage({ path: 'missing.png' })).toMatchObject({ ok: false, errorCode: 'image_not_found' });
    expect(await showImage({ path: 'out' })).toMatchObject({ ok: false, errorCode: 'image_not_a_file' });
    expect(await showImage({ path: 'notes.txt' })).toMatchObject({ ok: false, errorCode: 'not_an_image' });
  });

  it('rejects source files over the byte limit before it reads them', async () => {
    await writeFile(join(workspace, 'big.png'), await pngBytes(40, 30));
    const showImage = createShowImageToolHandler({ resolveWorkingDirectory: () => workspace, maxSourceBytes: 10 });

    expect(await showImage({ path: 'big.png' })).toMatchObject({ ok: false, errorCode: 'image_too_large' });
  });

  it('fails clearly when the session has no working directory', async () => {
    const showImage = createShowImageToolHandler({ resolveWorkingDirectory: () => null });

    expect(await showImage({ path: 'chart.png' })).toMatchObject({ ok: false, errorCode: 'session_directory_unavailable' });
  });
});
