// Diagnostic build only: counts streaming events and logs the counts each second to logcat
// (tag ReactNativeJS). Release builds strip console.*, so this calls nativeLoggingHook.
const counts: Record<string, number> = {};
let timer: ReturnType<typeof setInterval> | null = null;
let quietSeconds = 0;

function flush(): void {
    const keys = Object.keys(counts).sort();
    if (keys.length === 0) {
        quietSeconds += 1;
        if (quietSeconds > 5 && timer !== null) {
            clearInterval(timer);
            timer = null;
        }
        return;
    }
    quietSeconds = 0;
    const line = '[streamdiag] ' + keys.map((key) => `${key}=${counts[key]}`).join(' ');
    for (const key of keys) delete counts[key];
    const hook = (globalThis as { nativeLoggingHook?: (message: string, level: number) => void }).nativeLoggingHook;
    hook?.(line, 1);
}

export function diagCount(name: string): void {
    counts[name] = (counts[name] ?? 0) + 1;
    if (timer === null) timer = setInterval(flush, 1000);
}
