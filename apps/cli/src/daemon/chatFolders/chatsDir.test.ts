import { describe, expect, it } from 'vitest';

import { resolveChatsDir } from './chatsDir';

describe('resolveChatsDir', () => {
  it('expands ~ and drops a trailing separator', () => {
    expect(resolveChatsDir({ HAPPIER_CHATS_DIR: '~/projekter/chats/', HOME: '/home/u' })).toBe('/home/u/projekter/chats');
  });

  it('is null when unset, blank or relative', () => {
    expect(resolveChatsDir({ HOME: '/home/u' })).toBeNull();
    expect(resolveChatsDir({ HAPPIER_CHATS_DIR: '  ', HOME: '/home/u' })).toBeNull();
    expect(resolveChatsDir({ HAPPIER_CHATS_DIR: 'chats', HOME: '/home/u' })).toBeNull();
  });
});
