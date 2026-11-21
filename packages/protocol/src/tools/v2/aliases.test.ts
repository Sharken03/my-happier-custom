import { describe, expect, it } from 'vitest';

import { isChangeTitleToolLikeName, isChangeTitleToolNameAlias, isShowImageToolNameAlias } from './aliases.js';

describe('tools/v2 aliases', () => {
  it('treats opencode-style happier_change_title as a change_title alias', () => {
    expect(isChangeTitleToolNameAlias('happier_change_title')).toBe(true);
  });

  it('treats session_title_set MCP aliases as change_title aliases', () => {
    expect(isChangeTitleToolNameAlias('session_title_set')).toBe(true);
    expect(isChangeTitleToolNameAlias('mcp__happier__session_title_set')).toBe(true);
  });

  it('treats provider display names for title changes as change_title-like names', () => {
    expect(isChangeTitleToolLikeName('Change Title')).toBe(true);
    expect(isChangeTitleToolLikeName('Set session title')).toBe(true);
  });

  it('does not treat slash-style server/tool names as direct change_title aliases', () => {
    expect(isChangeTitleToolNameAlias('happier/change_title')).toBe(false);
    expect(isChangeTitleToolNameAlias('happy/change_title')).toBe(false);
  });

  it('treats the MCP and transport spellings of show_image as show_image aliases', () => {
    for (const name of ['show_image', 'mcp__happier__show_image', 'happier__show_image', 'happier_show_image', 'Show-Image']) {
      expect(isShowImageToolNameAlias(name)).toBe(true);
    }
    expect(isShowImageToolNameAlias('mcp__other__show_image')).toBe(false);
    expect(isShowImageToolNameAlias('Read')).toBe(false);
  });
});
