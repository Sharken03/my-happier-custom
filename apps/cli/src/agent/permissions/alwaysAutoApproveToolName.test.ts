import { describe, expect, it } from 'vitest';

import { isTrustedAlwaysAutoApproveToolName } from './alwaysAutoApproveToolName';

describe('isTrustedAlwaysAutoApproveToolName', () => {
  it('trusts the show_image tool under its transport names, but not look-alikes', () => {
    for (const name of ['show_image', 'mcp__happier__show_image', 'happier__show_image', 'happier_show_image']) {
      expect(isTrustedAlwaysAutoApproveToolName(name)).toBe(true);
    }
    expect(isTrustedAlwaysAutoApproveToolName('mcp__other__show_image')).toBe(false);
    expect(isTrustedAlwaysAutoApproveToolName('show_images_and_delete')).toBe(false);
  });

  it('keeps trusting change_title', () => {
    expect(isTrustedAlwaysAutoApproveToolName('mcp__happier__change_title')).toBe(true);
  });
});
