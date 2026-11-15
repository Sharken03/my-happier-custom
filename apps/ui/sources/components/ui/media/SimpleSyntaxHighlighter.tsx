import React from 'react';
import { Platform, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { tokenizeSimpleSyntaxText } from '@/components/ui/code/tokenization/simpleSyntaxTokenizer';
import { Text } from '@/components/ui/text/Text';


interface SimpleSyntaxHighlighterProps {
  code: string;
  language: string | null;
  selectable: boolean;
  wrap?: boolean;
  /** Extra text style merged over the default mono 14/20 style. */
  textStyle?: StyleProp<TextStyle>;
  /** Extra container style merged over the default layout style (e.g. `{ flex: 1 }`). */
  containerStyle?: StyleProp<ViewStyle>;
  /** Color for tokenized text that has no syntax class of its own (stderr/error tints). */
  defaultColor?: string;
}

function resolveTokenColor(theme: any, tokenType: string, defaultColor: string | undefined, fallback: string): string {
  if (tokenType === 'keyword') return theme.colors.syntax.keyword ?? fallback;
  if (tokenType === 'string') return theme.colors.syntax.string ?? fallback;
  if (tokenType === 'number') return theme.colors.syntax.number ?? fallback;
  if (tokenType === 'comment') return theme.colors.syntax.comment ?? fallback;
  // A caller-provided default colour (a stderr/error tint) outranks the theme's
  // generic token colour, so untinted text keeps the colour it had before.
  return defaultColor ?? theme.colors.syntax.default ?? fallback;
}

export const SimpleSyntaxHighlighter: React.FC<SimpleSyntaxHighlighterProps> = ({
  code,
  language,
  selectable,
  wrap = false,
  textStyle,
  containerStyle,
  defaultColor,
}: SimpleSyntaxHighlighterProps) => {
  const { theme } = useUnistyles();
  const fallback = defaultColor ?? theme.colors.text.primary ?? '#111';
  const webTextWrapStyle: TextStyle | null = Platform.OS === 'web'
    ? ({ whiteSpace: wrap ? 'pre-wrap' : 'pre', display: wrap ? 'block' : 'inline-block', overflowWrap: wrap ? 'anywhere' : undefined } as unknown as TextStyle)
    : null;

  const tokens = React.useMemo(() => tokenizeSimpleSyntaxText({ text: code, language }), [code, language]);

  const baseContainerStyle = { flexShrink: 0, alignSelf: wrap ? 'stretch' : 'flex-start' } as const;
  const baseTextStyle = {
    fontFamily: Typography.mono().fontFamily,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 0,
  } as const;

  return (
    <View style={containerStyle ? [baseContainerStyle, containerStyle] : baseContainerStyle}>
      <Text
        selectable={selectable}
        style={[baseTextStyle, webTextWrapStyle, textStyle]}
      >
        {tokens.map((token, index) => (
          <Text
            key={index}
            selectable={selectable}
            style={{
              color: resolveTokenColor(theme, token.type, defaultColor, fallback),
              // Fonts and sizes are inherited from the outer Text, so a caller that
              // overrides textStyle changes glyphs too, not just the wrapper.
              fontWeight: token.type === 'keyword' ? '600' : '400',
            }}
          >
            {token.text}
          </Text>
        ))}
      </Text>
    </View>
  );
};
