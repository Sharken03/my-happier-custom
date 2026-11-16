import { describe, expect, it } from 'vitest';

import {
  PI_CHAT_CHANGES_TEXT_MAX_BYTES,
  PiChatChangesDiffRequestSchema,
  PiChatChangesDiffResponseSchema,
  PiChatChangesListRequestSchema,
  PiChatChangesListResponseSchema,
} from './piChatChanges.js';
import { SESSION_RPC_METHODS } from './rpc.js';
import * as protocol from './index.js';

describe('Pi chat changes RPC contract', () => {
  it('defines the session RPC method names', () => {
    expect(SESSION_RPC_METHODS.PI_CHAT_CHANGES_LIST).toBe('pi.chatChanges.list');
    expect(SESSION_RPC_METHODS.PI_CHAT_CHANGES_DIFF).toBe('pi.chatChanges.diff');
  });

  it('exports the schemas from the package root', () => {
    expect(protocol.PiChatChangesListResponseSchema).toBe(PiChatChangesListResponseSchema);
    expect(protocol.PiChatChangesDiffResponseSchema).toBe(PiChatChangesDiffResponseSchema);
    expect(protocol.PI_CHAT_CHANGES_TEXT_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(PI_CHAT_CHANGES_TEXT_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it('parses list requests and responses', () => {
    expect(PiChatChangesListRequestSchema.parse({})).toEqual({});
    const file = {
      path: '/tmp/x.txt',
      created: false,
      tooLarge: false,
      deleted: false,
      added: 2,
      removed: 1,
      updatedAt: 1_700_000_000_000,
    };
    expect(PiChatChangesListResponseSchema.parse({ ok: true, files: [file] })).toEqual({ ok: true, files: [file] });
    expect(PiChatChangesListResponseSchema.parse({ ok: false, error: 'x' })).toEqual({ ok: false, error: 'x' });
    expect(PiChatChangesListResponseSchema.safeParse({ ok: true, files: [{ path: '/a' }] }).success).toBe(false);
  });

  it('parses diff requests and responses', () => {
    expect(PiChatChangesDiffRequestSchema.parse({ path: '/tmp/x.txt' })).toEqual({ path: '/tmp/x.txt' });
    expect(PiChatChangesDiffRequestSchema.safeParse({}).success).toBe(false);
    expect(PiChatChangesDiffRequestSchema.safeParse({ path: '' }).success).toBe(false);
    const ok = {
      ok: true,
      path: '/tmp/x.txt',
      before: null,
      after: 'a\n',
      created: true,
      tooLarge: false,
      binary: false,
    };
    expect(PiChatChangesDiffResponseSchema.parse(ok)).toEqual(ok);
    expect(PiChatChangesDiffResponseSchema.parse({ ok: false, error: 'not_in_list' })).toEqual({ ok: false, error: 'not_in_list' });
  });
});
