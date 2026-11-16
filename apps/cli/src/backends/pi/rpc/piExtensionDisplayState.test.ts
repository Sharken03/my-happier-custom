import { describe, expect, it } from 'vitest';

import { PiExtensionDisplayState, parsePiExtensionDisplayUpdate } from './piExtensionDisplayState';

function statusEvent(key: string, text?: string) {
  return { type: 'extension_ui_request', id: 'r1', method: 'setStatus', statusKey: key, statusText: text };
}

function widgetEvent(key: string, lines?: unknown) {
  return { type: 'extension_ui_request', id: 'r2', method: 'setWidget', widgetKey: key, widgetLines: lines };
}

describe('parsePiExtensionDisplayUpdate', () => {
  it('reads setStatus and clears it on an empty text', () => {
    expect(parsePiExtensionDisplayUpdate(statusEvent('plan-mode', 'plan ready')))
      .toEqual({ kind: 'status', key: 'plan-mode', text: 'plan ready' });
    expect(parsePiExtensionDisplayUpdate(statusEvent('plan-mode')))
      .toEqual({ kind: 'status', key: 'plan-mode', text: null });
  });

  it('drops host payload lines and terminal escapes from widgets', () => {
    expect(parsePiExtensionDisplayUpdate(widgetEvent('w', ['\u001b[2mPlan mode: planning\u001b[0m', 'PI_SUBAGENT_ASYNC_JSON:{"a":1}'])))
      .toEqual({ kind: 'widget', key: 'w', lines: ['Plan mode: planning'] });
    expect(parsePiExtensionDisplayUpdate(widgetEvent('subagent-async', ['PI_SUBAGENT_ASYNC_JSON:{}'])))
      .toEqual({ kind: 'widget', key: 'subagent-async', lines: null });
    expect(parsePiExtensionDisplayUpdate(widgetEvent('w')))
      .toEqual({ kind: 'widget', key: 'w', lines: null });
  });

  it('ignores blocking dialogs and other events', () => {
    expect(parsePiExtensionDisplayUpdate({ type: 'extension_ui_request', id: 'x', method: 'select', title: 't', options: ['a'] })).toBeNull();
    expect(parsePiExtensionDisplayUpdate({ type: 'message_update' })).toBeNull();
  });
});

describe('PiExtensionDisplayState', () => {
  it('publishes only changes, and again when forced', () => {
    const state = new PiExtensionDisplayState();
    expect(state.apply({ kind: 'status', key: 'plan-mode', text: 'plan active' })).toBe(true);
    expect(state.takeSnapshotToPublish()).toEqual({
      v: 1,
      statuses: [{ key: 'plan-mode', text: 'plan active' }],
      widgets: [],
    });
    expect(state.apply({ kind: 'status', key: 'plan-mode', text: 'plan active' })).toBe(false);
    expect(state.takeSnapshotToPublish()).toBeNull();
    expect(state.takeSnapshotToPublish(true)).not.toBeNull();
    expect(state.apply({ kind: 'status', key: 'plan-mode', text: null })).toBe(true);
    expect(state.takeSnapshotToPublish()).toEqual({ v: 1, statuses: [], widgets: [] });
  });
});
