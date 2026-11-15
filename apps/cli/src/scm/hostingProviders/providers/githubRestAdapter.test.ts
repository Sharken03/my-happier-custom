import { describe, expect, it, vi } from 'vitest';

import type { ScmHostingProvider } from '@happier-dev/protocol';

const provider: ScmHostingProvider = {
  kind: 'github',
  name: 'GitHub',
  baseUrl: 'https://github.com',
  nameWithOwner: 'happier-dev/happier',
  remoteName: 'origin',
};

describe('githubRestAdapter', () => {
  it('lists open pull requests through GitHub REST using connected-account tokens', async () => {
    const mod = await import('./githubRestAdapter').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected GitHub REST adapter module');

    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          number: 12,
          title: 'Add PR support',
          html_url: 'https://github.com/happier-dev/happier/pull/12',
          state: 'open',
          base: { ref: 'main' },
          head: { ref: 'feature/pr-support' },
          merged_at: null,
        },
      ],
      text: async () => '',
    }));

    const adapter = mod.createGithubRestAdapter({ fetcher });
    if (!adapter.listOpenPullRequests) throw new Error('expected GitHub REST list adapter');
    const pullRequests = await adapter.listOpenPullRequests({
      provider,
      token: 'ghp_token',
      head: 'feature/pr-support',
    });

    expect(pullRequests).toEqual([
      {
        provider,
        number: 12,
        title: 'Add PR support',
        url: 'https://github.com/happier-dev/happier/pull/12',
        baseBranch: 'main',
        headBranch: 'feature/pr-support',
        state: 'open',
      },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain('/repos/happier-dev/happier/pulls');
    expect(fetcher.mock.calls[0]?.[0]).toContain('head=happier-dev%3Afeature%2Fpr-support');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer ghp_token',
    });
  });

  it('creates pull requests through GitHub REST using connected-account tokens', async () => {
    const mod = await import('./githubRestAdapter').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected GitHub REST adapter module');

    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({
        number: 42,
        title: 'Ship PR support',
        html_url: 'https://github.com/happier-dev/happier/pull/42',
        state: 'open',
        base: { ref: 'main' },
        head: { ref: 'feature/pr-support' },
        merged_at: null,
      }),
      text: async () => '',
    }));

    const adapter = mod.createGithubRestAdapter({ fetcher });
    if (!adapter.createPullRequest) throw new Error('expected GitHub REST create adapter');

    await expect(adapter.createPullRequest({
      provider,
      token: 'ghp_token',
      base: 'main',
      head: 'feature/pr-support',
      title: 'Ship PR support',
      body: 'Implements PR management.',
    })).resolves.toMatchObject({
      number: 42,
      title: 'Ship PR support',
      url: 'https://github.com/happier-dev/happier/pull/42',
    });

    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer ghp_token',
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      base: 'main',
      head: 'feature/pr-support',
      title: 'Ship PR support',
      body: 'Implements PR management.',
    });
  });

  it('describes repository publish targets from the authenticated GitHub account', async () => {
    const mod = await import('./githubRestAdapter').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected GitHub REST adapter module');

    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => url.endsWith('/user')
        ? { login: 'happier-dev' }
        : [
          { login: 'happier-org' },
        ],
      text: async () => '',
    }));

    const adapter = mod.createGithubRestAdapter({ fetcher }) as Record<string, unknown>;
    expect(adapter.listRepositoryPublishTargets).toBeTypeOf('function');
    const listRepositoryPublishTargets = adapter.listRepositoryPublishTargets;
    if (typeof listRepositoryPublishTargets !== 'function') throw new Error('expected GitHub REST publish-target adapter');

    await expect(listRepositoryPublishTargets({
      providerBaseUrl: 'https://github.com',
      token: 'ghp_token',
    })).resolves.toEqual([
      {
        providerKind: 'github',
        owner: 'happier-dev',
        ownerKind: 'user',
        label: 'happier-dev',
        default: true,
        supportedVisibilities: ['private', 'public'],
      },
      {
        providerKind: 'github',
        owner: 'happier-org',
        ownerKind: 'org',
        label: 'happier-org',
        supportedVisibilities: ['private', 'public', 'internal'],
      },
    ]);
  });

  it('creates repositories through GitHub REST without mutating local git remotes', async () => {
    const mod = await import('./githubRestAdapter').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected GitHub REST adapter module');

    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({
        full_name: 'happier-dev/happier',
        html_url: 'https://github.com/happier-dev/happier',
        clone_url: 'https://github.com/happier-dev/happier.git',
        ssh_url: 'git@github.com:happier-dev/happier.git',
        private: true,
        default_branch: 'main',
      }),
      text: async () => '',
    }));

    const adapter = mod.createGithubRestAdapter({ fetcher }) as Record<string, unknown>;
    expect(adapter.createRepository).toBeTypeOf('function');
    const createRepository = adapter.createRepository;
    if (typeof createRepository !== 'function') throw new Error('expected GitHub REST repository create adapter');

    await expect(createRepository({
      providerBaseUrl: 'https://github.com',
      token: 'ghp_token',
      owner: 'happier-dev',
      ownerKind: 'user',
      repositoryName: 'happier',
      visibility: 'private',
      description: 'A calmer coding workspace.',
    })).resolves.toMatchObject({
      nameWithOwner: 'happier-dev/happier',
      cloneUrl: 'https://github.com/happier-dev/happier.git',
      visibility: 'private',
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/user/repos');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      name: 'happier',
      private: true,
      description: 'A calmer coding workspace.',
    });
  });

  it('creates a pull request review through GitHub REST with LEFT/RIGHT side mapping', async () => {
    const mod = await import('./githubRestAdapter').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected GitHub REST adapter module');

    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        id: 7,
        html_url: 'https://github.com/happier-dev/happier/pull/42#pullrequestreview-7',
      }),
      text: async () => '',
    }));

    const adapter = mod.createGithubRestAdapter({ fetcher });
    if (!adapter.createPullRequestReview) throw new Error('expected GitHub REST review adapter');

    await expect(adapter.createPullRequestReview({
      provider,
      token: 'ghp_token',
      number: 42,
      event: 'request_changes',
      body: 'Please fix the diff.',
      comments: [
        { path: 'src/a.ts', line: 3, body: 'Use a named constant.' },
        { path: 'src/b.ts', line: 9, side: 'old', body: 'Revert this.' },
      ],
    })).resolves.toEqual({
      reviewId: '7',
      url: 'https://github.com/happier-dev/happier/pull/42#pullrequestreview-7',
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/happier-dev/happier/pulls/42/reviews');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer ghp_token',
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      body: 'Please fix the diff.',
      event: 'REQUEST_CHANGES',
      comments: [
        { path: 'src/a.ts', line: 3, side: 'RIGHT', body: 'Use a named constant.' },
        { path: 'src/b.ts', line: 9, side: 'LEFT', body: 'Revert this.' },
      ],
    });
  });

  it('throws when GitHub REST review creation fails', async () => {
    const mod = await import('./githubRestAdapter').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected GitHub REST adapter module');

    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({}),
      text: async () => 'Validation failed',
    }));

    const adapter = mod.createGithubRestAdapter({ fetcher });
    if (!adapter.createPullRequestReview) throw new Error('expected GitHub REST review adapter');

    await expect(adapter.createPullRequestReview({
      provider,
      token: 'ghp_token',
      number: 42,
      event: 'comment',
      body: '',
      comments: [],
    })).rejects.toThrow('GitHub request failed (422): Validation failed');
  });
});
