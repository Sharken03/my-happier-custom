import { describe, expect, it } from 'vitest';

import { detectAgyAcpLaunchResolution } from './runtimeInstallable';

describe('agy ACP runtime installable', () => {
  it('is ready without a managed install when HAPPIER_AGY_ACP_COMMAND names the server', async () => {
    await expect(detectAgyAcpLaunchResolution({ env: { HAPPIER_AGY_ACP_COMMAND: process.execPath } })).resolves.toEqual({
      availability: { ok: true },
      canAutoInstall: false,
      canBackgroundAutoUpdate: false,
    });
  });
});
