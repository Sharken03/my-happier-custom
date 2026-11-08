import { describe, expect, it } from 'vitest';

import { newChatFolderName, newChatFolderPath } from './newChatFolder';

describe('newChatFolder', () => {
    it('names a chat folder by local date and a short random id', () => {
        const now = new Date(2026, 10, 8, 23, 59);
        expect(newChatFolderName(now, () => 0)).toBe('2026-11-08-0000');
        expect(newChatFolderName(now, () => 0.9999999)).toBe('2026-11-08-zzzz');
    });

    it('joins the chats folder with its own separator and without a doubled one', () => {
        const now = new Date(2026, 0, 2);
        expect(newChatFolderPath('/home/u/chats/', now, () => 0)).toBe('/home/u/chats/2026-01-02-0000');
        expect(newChatFolderPath('C:\\Users\\u\\chats', now, () => 0)).toBe('C:\\Users\\u\\chats\\2026-01-02-0000');
    });
});
