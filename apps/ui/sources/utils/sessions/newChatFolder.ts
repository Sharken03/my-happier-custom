/**
 * A new chat's own folder inside a machine's chats folder (machine metadata `chatsDir`, set by the
 * daemon from HAPPIER_CHATS_DIR): `<chatsDir>/<YYYY-MM-DD>-<4 base-36 characters>`, in local time.
 * The name never changes after the chat starts: agents key their transcripts by the session path,
 * so the daemon links a readable title name to it instead of renaming it.
 */
export function newChatFolderName(now: Date, random: () => number = Math.random): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const id = Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0');
    return `${date}-${id}`;
}

export function newChatFolderPath(chatsDir: string, now: Date, random?: () => number): string {
    const separator = chatsDir.includes('\\') && !chatsDir.includes('/') ? '\\' : '/';
    const base = chatsDir.replace(/[\\/]+$/, '');
    return `${base}${separator}${newChatFolderName(now, random)}`;
}

const CHAT_FOLDER_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-z]{4}$/;

/**
 * The folder that holds a chat's own folder (newChatFolderName), or null when the path is not a
 * chat folder. Lists group all chats under this folder instead of one group per chat.
 */
export function chatFolderParent(path: string): string | null {
    const trimmed = path.replace(/[\\/]+$/, '');
    const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    if (cut <= 0) return null;
    return CHAT_FOLDER_NAME.test(trimmed.slice(cut + 1)) ? trimmed.slice(0, cut) : null;
}
