import { describe, expect, it } from 'vitest';

import { isDaemonProcessArgv } from './configuration';
import { parseCliArgs } from './cli/parseArgs';

describe('isDaemonProcessArgv', () => {
  it('treats daemon start as daemon process', () => {
    expect(isDaemonProcessArgv(['daemon', 'start'])).toBe(true);
  });

  it('treats daemon start-sync as daemon process', () => {
    expect(isDaemonProcessArgv(['daemon', 'start-sync'])).toBe(true);
  });

  it('treats bun-wrapped daemon start-sync as a daemon process after argv normalization', () => {
    const { args } = parseCliArgs([
      '/Users/test/.happier/runtime/current/cli/package-dist/index.mjs',
      'daemon',
      'start-sync',
    ]);
    expect(isDaemonProcessArgv(args)).toBe(true);
  });

  it('treats daemon start-sync behind server selection prefix flags as a daemon process', () => {
    expect(isDaemonProcessArgv(['--server', 'relay.example', 'daemon', 'start-sync'])).toBe(true);
    expect(isDaemonProcessArgv(['--server=relay.example', 'daemon', 'start'])).toBe(true);
    expect(isDaemonProcessArgv([
      '--server-url', 'https://relay.example', '--webapp-url=https://app.example', 'daemon', 'start-sync',
    ])).toBe(true);
  });

  it('does not treat other commands behind server selection prefix flags as a daemon process', () => {
    expect(isDaemonProcessArgv(['--server', 'relay.example', 'daemon', 'status'])).toBe(false);
    expect(isDaemonProcessArgv(['--server', 'daemon', 'start'])).toBe(false);
  });

  it('does not treat other commands as daemon process', () => {
    expect(isDaemonProcessArgv(['daemon', 'logs'])).toBe(false);
    expect(isDaemonProcessArgv(['session', 'list'])).toBe(false);
  });
});
