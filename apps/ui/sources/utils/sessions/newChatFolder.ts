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
