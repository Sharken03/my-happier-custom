import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    piSubagentUsageFolder,
    readPiSubagentUsageReports,
    resolvePiAgentDir,
    writePiSubagentOwnerFile,
} from './piSubagentUsageReports';

describe('piSubagentUsageReports', () => {
    let root = '';
    afterEach(() => {
        if (root) rmSync(root, { recursive: true, force: true });
        root = '';
    });

    function folder(): string {
        root = mkdtempSync(join(tmpdir(), 'pi-subagent-usage-'));
        return piSubagentUsageFolder(root, 's1');
    }

    it('writes owner.json with the pid', () => {
        const dir = folder();
        writePiSubagentOwnerFile(dir, 1234);
        expect(JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))).toEqual({ v: 2, pid: 1234 });
    });

    it('reports each subagent of this process, keyed by the subagent id', () => {
        const dir = folder();
        writePiSubagentOwnerFile(dir, 1234);
        const totals = { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, cost: 0.25 };
        writeFileSync(join(dir, 'c1.json'), JSON.stringify({ v: 2, sessionId: 'c1', parentPid: 1234, totals }));
        writeFileSync(join(dir, 'c2.json'), JSON.stringify({ v: 2, sessionId: 'c2', parentPid: 999, totals }));
        writeFileSync(join(dir, 'c3.json'), JSON.stringify({ v: 1, sessionId: 'c3', totals }));
        writeFileSync(join(dir, 'c4.json'), '{bad');
        expect(readPiSubagentUsageReports(dir, 's1', 1234)).toEqual([
            {
                key: 'pi:c1',
                sessionId: 's1',
                tokens: { total: 115, input: 10, output: 5, cache_creation: 0, cache_read: 100 },
                cost: { total: 0.25 },
            },
        ]);
    });

    it('returns nothing when the folder does not exist', () => {
        expect(readPiSubagentUsageReports(join(tmpdir(), 'no-such-folder-x'), 's1', 1)).toEqual([]);
    });

    it('uses PI_CODING_AGENT_DIR when it is set', () => {
        expect(resolvePiAgentDir({ PI_CODING_AGENT_DIR: '/x/agent' })).toBe('/x/agent');
        expect(resolvePiAgentDir({})).toMatch(/\.pi[/\\]agent$/);
    });
});
