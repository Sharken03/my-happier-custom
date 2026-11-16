import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Usage of the Pi subagents that the Bash commands of a Claude chat start.
 *
 * The Pi extension subagent-usage (repo pi-extensions) writes the running totals of each such
 * subagent to `<Pi agent dir>/subagent-usage/happier-<session id>/<subagent id>.json`. It writes
 * there only when `owner.json` in that folder names a live ancestor pid, so this CLI writes its
 * own pid to that file when the session starts. A subagent file counts only when its parentPid
 * is this process, so files from older processes and stale session ids do not count.
 */

const OWNER_FILE = 'owner.json';

export type PiSubagentUsageReport = {
    key: string;
    sessionId: string;
    tokens: { total: number; input: number; output: number; cache_creation: number; cache_read: number };
    cost: { total: number };
};

/** The Pi agent dir: PI_CODING_AGENT_DIR, else ~/.pi/agent. */
export function resolvePiAgentDir(env: NodeJS.ProcessEnv): string {
    const dir = env.PI_CODING_AGENT_DIR?.trim();
    return dir ? dir : join(homedir(), '.pi', 'agent');
}

/** The folder that the subagents of this Happier session write to. */
export function piSubagentUsageFolder(agentDir: string, sessionId: string): string {
    return join(agentDir, 'subagent-usage', `happier-${sessionId}`);
}

/** Writes owner.json with this process's pid, so the subagents of this session report here. */
export function writePiSubagentOwnerFile(folder: string, pid: number): void {
    mkdirSync(folder, { recursive: true });
    const file = join(folder, OWNER_FILE);
    const tmp = `${file}.${pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 2, pid }));
    renameSync(tmp, file);
}

function positive(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** One usage report per subagent file whose parentPid is `pid`. Key `pi:<subagent id>`. */
export function readPiSubagentUsageReports(folder: string, sessionId: string, pid: number): PiSubagentUsageReport[] {
    let names: string[];
    try {
        names = readdirSync(folder);
    } catch {
        return [];
    }
    const reports: PiSubagentUsageReport[] = [];
    for (const name of names) {
        if (!name.endsWith('.json') || name === OWNER_FILE) continue;
        try {
            const data = JSON.parse(readFileSync(join(folder, name), 'utf8'));
            const id = typeof data?.sessionId === 'string' ? data.sessionId : '';
            if (!id || data.parentPid !== pid) continue;
            const totals = data.totals ?? {};
            const input = positive(totals.input);
            const output = positive(totals.output);
            const cacheRead = positive(totals.cacheRead);
            const cacheWrite = positive(totals.cacheWrite);
            reports.push({
                key: `pi:${id}`,
                sessionId,
                tokens: { total: input + output + cacheRead + cacheWrite, input, output, cache_creation: cacheWrite, cache_read: cacheRead },
                cost: { total: positive(totals.cost) },
            });
        } catch {
            // A file that is being written is read again at the next message.
        }
    }
    return reports;
}
