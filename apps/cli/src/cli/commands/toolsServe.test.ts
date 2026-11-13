import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { serveToolCalls } from './toolsServe';

describe('serveToolCalls', () => {
  it('keeps serving when one result cannot be written, without an unhandled rejection', async () => {
    const input = new PassThrough();
    const written: string[] = [];
    let failNextResult = true;
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const serving = serveToolCalls({ sessionId: 'sess-1' }, {
        readCredentials: async () => ({ token: 'token' }) as never,
        callBuiltInHappierTool: (async () => ({ ok: true as const, result: {} })) as never,
        input,
        writeLine: (line) => {
          // The host pipe can close between a call and its result (Pi exited).
          if (line.includes('happier-tools-serve-result') && failNextResult) {
            failNextResult = false;
            throw new Error('write after end');
          }
          written.push(line);
        },
        idleExitMs: null,
      });

      input.write(JSON.stringify({ type: 'happier-tools-serve-call', id: 1, tool: 'change_title', args: {} }) + '\n');
      input.write(JSON.stringify({ type: 'happier-tools-serve-call', id: 2, tool: 'change_title', args: {} }) + '\n');
      await vi.waitFor(() => expect(written.map((line) => JSON.parse(line).id ?? 'ready')).toEqual(['ready', 2]));
      input.end();
      await serving;
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
