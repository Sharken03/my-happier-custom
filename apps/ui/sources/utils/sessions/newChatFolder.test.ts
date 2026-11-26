import { describe, expect, it } from 'vitest';

import { chatFolderParent, newChatFolderName, newChatFolderPath } from './newChatFolder';

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

    it('finds the chats folder that holds a chat folder, and nothing for other folders', () => {
        expect(chatFolderParent('/home/u/projekter/chats/2026-11-09-oj7s')).toBe('/home/u/projekter/chats');
        expect(chatFolderParent('/home/u/projekter/chats/2026-11-09-oj7s/')).toBe('/home/u/projekter/chats');
        expect(chatFolderParent('C:\\Users\\u\\chats\\2026-01-02-0000')).toBe('C:\\Users\\u\\chats');
        expect(chatFolderParent('/home/u/projekter/happier')).toBeNull();
        expect(chatFolderParent('/home/u/chats/2026-11-09-oj7s/sub')).toBeNull();
        expect(chatFolderParent('2026-11-09-oj7s')).toBeNull();
    });
});
