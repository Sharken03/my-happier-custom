import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installToolShellCommonModuleMocks, makeToolCall } from './ToolView.testHelpers';
import {
  renderScreen,
  standardCleanup,
} from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installToolShellCommonModuleMocks({
});

vi.mock('@/sync/sync', () => ({
  sync: {
    ensureSidechainMessagesLoaded: vi.fn(),
  },
}));

vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

vi.mock('@/components/ui/media/CodeView', () => ({
  CodeView: () => null,
}));

vi.mock('@/components/tools/catalog', () => ({
  knownTools: {},
}));

vi.mock('@/components/tools/renderers/system/StructuredResultView', () => ({
  StructuredResultView: () => null,
}));

vi.mock('../permissions/PermissionFooter', () => ({
  PermissionFooter: () => null,
}));

vi.mock('@/components/tools/renderers/core/_registry', () => ({
  getToolViewComponent: () => null,
}));

// The preview read goes to the daemon over RPC: a system boundary.
vi.mock('@/components/sessions/files/content/imagePreview/useSessionImagePreview', () => ({
  useSessionImagePreview: () => ({ status: 'loaded', uri: 'blob:preview', svgXml: null, error: null }),
}));

vi.mock('@/components/sessions/attachments/preview/AttachmentImagePreviewModal', () => ({
  AttachmentImagePreviewModal: () => null,
}));

const IMAGE_PATH = '.happier/uploads/tool/message-1/shot.png';

const meta = {
  happier: {
    kind: 'session_media.v1',
    payload: {
      media: [
        {
          id: 'media-1',
          role: 'output',
          category: 'tool-artifact',
          mediaKind: 'image',
          name: 'shot.png',
          path: IMAGE_PATH,
          mimeType: 'image/png',
          sizeBytes: 10,
          width: 800,
          height: 600,
          origin: { source: 'tool-output', toolCallId: 'tool-1' },
        },
      ],
    },
  },
};

describe('ToolFullView (result media)', () => {
  afterEach(() => {
    standardCleanup();
  });

  it('shows the images of the call result in the detail', async () => {
    const { ToolFullView } = await import('./ToolFullView');

    const screen = await renderScreen(React.createElement(ToolFullView, {
      tool: makeToolCall({ name: 'Read', input: { file_path: '/tmp/shot.png' }, result: '[session media]' }),
      owningMessageId: 'tool-message-1',
      sessionId: 's1',
      metadata: null,
      messages: [],
      meta,
      interaction: { canSendMessages: true, canApprovePermissions: true, canPreviewMedia: true, canOpenFiles: true } as any,
    }));

    expect(screen.findByTestId(`message-session-media-inline-image:${IMAGE_PATH}`)).toBeTruthy();
  });
});
