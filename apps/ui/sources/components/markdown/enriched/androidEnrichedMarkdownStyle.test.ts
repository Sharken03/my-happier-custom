import { describe, expect, it } from 'vitest';

import { adaptEnrichedMarkdownStyleForAndroid } from './androidEnrichedMarkdownStyle';

describe('adaptEnrichedMarkdownStyleForAndroid', () => {
    it('lets the renderer derive bold, italic and monospace faces, and draws no inline code background', () => {
        const adapted = adaptEnrichedMarkdownStyleForAndroid({
            paragraph: { fontFamily: 'Inter-Regular', fontSize: 16 },
            strong: { fontFamily: 'Inter-SemiBold', fontWeight: 'normal', color: '#111111' },
            em: { fontFamily: 'Inter-Italic', fontStyle: 'normal', color: '#111111' },
            code: { fontFamily: 'IBMPlexMono-Regular', fontSize: 14, color: '#111111', backgroundColor: '#dddddd' },
        });

        expect(adapted.strong).toEqual({ fontFamily: '', fontWeight: 'bold', color: '#111111' });
        expect(adapted.em).toEqual({ fontFamily: '', fontStyle: 'italic', color: '#111111' });
        expect(adapted.code).toMatchObject({ fontFamily: '', fontSize: 14, backgroundColor: 'transparent' });
        expect(adapted.paragraph).toEqual({ fontFamily: 'Inter-Regular', fontSize: 16 });
    });
});
