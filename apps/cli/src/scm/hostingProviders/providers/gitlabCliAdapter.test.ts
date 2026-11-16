import { describe, expect, it, vi } from 'vitest';

import type { ScmHostingProvider } from '@happier-dev/protocol';

const provider: ScmHostingProvider = {
    kind: 'gitlab',
    name: 'GitLab',
    baseUrl: 'https://gitlab.com',
    nameWithOwner: 'happier-dev/mobile/app',
    remoteName: 'origin',
};

describe('gitlabCliAdapter', () => {
    it('lists open merge requests through an authenticated local glab CLI', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async () => ({
            success: true,
            stdout: JSON.stringify([
                {
                    iid: 17,
                    title: 'Add GitLab support',
                    web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                    state: 'opened',
                    source_branch: 'feature/gitlab',
                    target_branch: 'main',
                },
            ]),
            stderr: '',
            exitCode: 0,
        }));

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.listOpenPullRequests) throw new Error('expected GitLab CLI list adapter');

        await expect(adapter.listOpenPullRequests({
            provider,
            base: 'main',
            head: 'feature/gitlab',
        })).resolves.toEqual([
            {
                provider,
                number: 17,
                title: 'Add GitLab support',
                url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                baseBranch: 'main',
                headBranch: 'feature/gitlab',
                state: 'open',
            },
        ]);

        expect(runCommand).toHaveBeenCalledWith({
            args: [
                'mr',
                'list',
                '--repo',
                'happier-dev/mobile/app',
                '--state',
                'opened',
                '--output',
                'json',
                '--target-branch',
                'main',
                '--source-branch',
                'feature/gitlab',
            ],
            timeoutMs: expect.any(Number),
        });
    });

    it('creates a merge request through glab and then reads the created MR summary', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async ({ args }: { args: readonly string[] }) => {
            if (args[0] === 'api' && args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests')) {
                expect(args).not.toContain('Implements merge request management.');
                return {
                    success: true,
                    stdout: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/18\n',
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args[0] === 'mr' && args[1] === 'view') {
                return {
                    success: true,
                    stdout: JSON.stringify({
                        iid: 18,
                        title: 'Ship GitLab support',
                        web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/18',
                        state: 'opened',
                        source_branch: 'feature/gitlab',
                        target_branch: 'main',
                    }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            return {
                success: false,
                stdout: '',
                stderr: `unexpected glab args: ${args.join(' ')}`,
                exitCode: 1,
            };
        });

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequest) throw new Error('expected GitLab CLI create adapter');

        await expect(adapter.createPullRequest({
            provider,
            base: 'main',
            head: 'feature/gitlab',
            title: 'Ship GitLab support',
            body: 'Implements merge request management.',
        })).resolves.toMatchObject({
            number: 18,
            title: 'Ship GitLab support',
            url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/18',
            baseBranch: 'main',
            headBranch: 'feature/gitlab',
            state: 'open',
        });

        expect(runCommand).toHaveBeenCalledWith({
            args: [
                'api',
                '--hostname',
                'gitlab.com',
                '--method',
                'POST',
                'projects/happier-dev%2Fmobile%2Fapp/merge_requests',
                '--raw-field',
                'source_branch=feature/gitlab',
                '--raw-field',
                'target_branch=main',
                '--raw-field',
                'title=Ship GitLab support',
                '--field',
                expect.stringMatching(/^description=@.+/),
            ],
            timeoutMs: expect.any(Number),
        });
    });

    it('creates a GitLab review as MR discussions using diff_refs from the MR', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async ({ args }: { args: readonly string[] }) => {
            if (args[0] === 'api' && args[3] === 'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17') {
                return {
                    success: true,
                    stdout: JSON.stringify({
                        iid: 17,
                        web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                        diff_refs: { base_sha: 'base1', head_sha: 'head1', start_sha: 'start1' },
                    }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args[0] === 'api' && args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions')) {
                return {
                    success: true,
                    stdout: JSON.stringify({ id: 'disc-1', notes: [] }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            return {
                success: false,
                stdout: '',
                stderr: `unexpected glab args: ${args.join(' ')}`,
                exitCode: 1,
            };
        });

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequestReview) throw new Error('expected GitLab CLI review adapter');

        await expect(adapter.createPullRequestReview({
            provider,
            number: 17,
            event: 'comment',
            body: '',
            comments: [
                { path: 'src/a.ts', line: 3, body: 'Use a named constant.' },
                { path: 'src/b.ts', line: 9, side: 'old', body: 'Revert this.' },
            ],
        })).resolves.toEqual({
            reviewId: 'disc-1',
            url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
        });

        expect(runCommand).toHaveBeenNthCalledWith(1, {
            args: ['api', '--hostname', 'gitlab.com', 'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17'],
            timeoutMs: expect.any(Number),
        });
        expect(runCommand).toHaveBeenNthCalledWith(2, {
            args: [
                'api',
                '--hostname',
                'gitlab.com',
                '--method',
                'POST',
                'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions',
                '--field',
                `position=${JSON.stringify({
                    base_sha: 'base1',
                    head_sha: 'head1',
                    start_sha: 'start1',
                    position_type: 'text',
                    new_path: 'src/a.ts',
                    new_line: 3,
                })}`,
                '--raw-field',
                'body=Use a named constant.',
            ],
            timeoutMs: expect.any(Number),
        });
        expect(runCommand).toHaveBeenNthCalledWith(3, {
            args: [
                'api',
                '--hostname',
                'gitlab.com',
                '--method',
                'POST',
                'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions',
                '--field',
                `position=${JSON.stringify({
                    base_sha: 'base1',
                    head_sha: 'head1',
                    start_sha: 'start1',
                    position_type: 'text',
                    old_path: 'src/b.ts',
                    old_line: 9,
                })}`,
                '--raw-field',
                'body=Revert this.',
            ],
            timeoutMs: expect.any(Number),
        });
    });

    it('posts a plain MR note before discussions when the event is not comment', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async ({ args }: { args: readonly string[] }) => {
            if (args[0] === 'api' && args[3] === 'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17') {
                return {
                    success: true,
                    stdout: JSON.stringify({
                        web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                        diff_refs: { base_sha: 'base1', head_sha: 'head1', start_sha: 'start1' },
                    }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/notes')) {
                return {
                    success: true,
                    stdout: JSON.stringify({ id: 9001 }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions')) {
                return {
                    success: true,
                    stdout: JSON.stringify({ id: 'disc-1' }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            return {
                success: false,
                stdout: '',
                stderr: `unexpected glab args: ${args.join(' ')}`,
                exitCode: 1,
            };
        });

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequestReview) throw new Error('expected GitLab CLI review adapter');

        await expect(adapter.createPullRequestReview({
            provider,
            number: 17,
            event: 'approve',
            body: 'Approving on behalf of the team.',
            comments: [{ path: 'src/a.ts', line: 1, body: 'ok' }],
        })).resolves.toEqual({
            // The MR-level note is the review artifact GitLab returns first; the discussion is per line.
            reviewId: '9001',
            url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
            postedCommentCount: 1,
            // This stub has no /approve handler, so the verdict could not be recorded.
            eventApplied: false,
        });

        expect(runCommand).toHaveBeenNthCalledWith(2, {
            args: [
                'api',
                '--hostname',
                'gitlab.com',
                '--method',
                'POST',
                'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/notes',
                '--raw-field',
                'body=Approving on behalf of the team.',
            ],
            timeoutMs: expect.any(Number),
        });
    });

    it('posts a body-only review as a plain MR note when there are no inline comments', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async ({ args }: { args: readonly string[] }) => {
            if (args[0] === 'api' && args[3] === 'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17') {
                return {
                    success: true,
                    stdout: JSON.stringify({
                        web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                        diff_refs: { base_sha: 'base1', head_sha: 'head1', start_sha: 'start1' },
                    }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/notes')) {
                return {
                    success: true,
                    stdout: JSON.stringify({ id: 4242 }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            return {
                success: false,
                stdout: '',
                stderr: `unexpected glab args: ${args.join(' ')}`,
                exitCode: 1,
            };
        });

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequestReview) throw new Error('expected GitLab CLI review adapter');

        await expect(adapter.createPullRequestReview({
            provider,
            number: 17,
            event: 'comment',
            body: 'Findings without a location go in the review body.',
            comments: [],
        })).resolves.toEqual({
            reviewId: '4242',
            url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
        });

        expect(runCommand).toHaveBeenCalledTimes(2);
        expect(runCommand).not.toHaveBeenCalledWith(expect.objectContaining({
            args: expect.arrayContaining(['projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions']),
        }));
    });

    it('posts the body note alongside inline comments for a plain comment review', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async ({ args }: { args: readonly string[] }) => {
            if (args[0] === 'api' && args[3] === 'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17') {
                return {
                    success: true,
                    stdout: JSON.stringify({
                        web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                        diff_refs: { base_sha: 'base1', head_sha: 'head1', start_sha: 'start1' },
                    }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/notes')) {
                return { success: true, stdout: JSON.stringify({ id: 5150 }), stderr: '', exitCode: 0 };
            }
            if (args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions')) {
                return { success: true, stdout: JSON.stringify({ id: 'disc-9' }), stderr: '', exitCode: 0 };
            }
            return { success: false, stdout: '', stderr: `unexpected glab args: ${args.join(' ')}`, exitCode: 1 };
        });

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequestReview) throw new Error('expected GitLab CLI review adapter');

        const result = await adapter.createPullRequestReview({
            provider,
            number: 17,
            event: 'comment',
            // This body carries the findings that could not be anchored to a line: dropping it loses them.
            body: 'Two findings had no file or line and are listed here.',
            comments: [{ path: 'src/a.ts', line: 4, body: 'inline note' }],
        });

        expect(result).toMatchObject({ reviewId: '5150', postedCommentCount: 1 });
        // Body note AND the inline discussion, not one instead of the other.
        expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
            args: expect.arrayContaining(['projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/notes']),
        }));
        expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
            args: expect.arrayContaining(['projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions']),
        }));
    });

    it('reports a request_changes verdict as not applied', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async ({ args }: { args: readonly string[] }) => {
            if (args[0] === 'api' && args[3] === 'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17') {
                return {
                    success: true,
                    stdout: JSON.stringify({
                        web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                        diff_refs: { base_sha: 'base1', head_sha: 'head1', start_sha: 'start1' },
                    }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/notes')) {
                return { success: true, stdout: JSON.stringify({ id: 6161 }), stderr: '', exitCode: 0 };
            }
            return { success: false, stdout: '', stderr: `unexpected glab args: ${args.join(' ')}`, exitCode: 1 };
        });

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequestReview) throw new Error('expected GitLab CLI review adapter');

        const result = await adapter.createPullRequestReview({
            provider,
            number: 17,
            event: 'request_changes',
            body: 'Blocking finding.',
            comments: [],
        });

        // GitLab has no request-changes state: the review exists, the verdict does not.
        expect(result.eventApplied).toBe(false);
    });

    it('reports how many inline comments landed when a discussion write fails part-way', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        let discussions = 0;
        const runCommand = vi.fn(async ({ args }: { args: readonly string[] }) => {
            if (args[0] === 'api' && args[3] === 'projects/happier-dev%2Fmobile%2Fapp/merge_requests/17') {
                return {
                    success: true,
                    stdout: JSON.stringify({
                        web_url: 'https://gitlab.com/happier-dev/mobile/app/-/merge_requests/17',
                        diff_refs: { base_sha: 'base1', head_sha: 'head1', start_sha: 'start1' },
                    }),
                    stderr: '',
                    exitCode: 0,
                };
            }
            if (args.includes('projects/happier-dev%2Fmobile%2Fapp/merge_requests/17/discussions')) {
                discussions += 1;
                if (discussions > 1) {
                    return { success: false, stdout: '', stderr: 'glab: 500 server error', exitCode: 1 };
                }
                return { success: true, stdout: JSON.stringify({ id: `disc-${discussions}` }), stderr: '', exitCode: 0 };
            }
            return { success: false, stdout: '', stderr: `unexpected glab args: ${args.join(' ')}`, exitCode: 1 };
        });

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequestReview) throw new Error('expected GitLab CLI review adapter');

        await expect(adapter.createPullRequestReview({
            provider,
            number: 17,
            event: 'comment',
            body: '',
            comments: [
                { path: 'src/a.ts', line: 1, body: 'first' },
                { path: 'src/a.ts', line: 2, body: 'second' },
            ],
        })).rejects.toThrow(/posted 1 of 2 inline comments/);
    });

    it('throws when the GitLab MR fetch fails', async () => {
        const mod = await import('./gitlabCliAdapter').catch(() => null);
        expect(mod).not.toBeNull();
        if (!mod) throw new Error('expected GitLab CLI adapter module');

        const runCommand = vi.fn(async () => ({
            success: false,
            stdout: '',
            stderr: 'glab: 404 Not Found',
            exitCode: 1,
        }));

        const adapter = mod.createGitlabCliAdapter({ runCommand });
        if (!adapter.createPullRequestReview) throw new Error('expected GitLab CLI review adapter');

        await expect(adapter.createPullRequestReview({
            provider,
            number: 17,
            event: 'comment',
            body: '',
            comments: [],
        })).rejects.toThrow('glab: 404 Not Found');
    });
});
