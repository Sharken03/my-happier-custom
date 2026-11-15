import * as React from 'react';
import { View, Platform, type StyleProp, type TextStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { Text } from '@/components/ui/text/Text';
import { SimpleSyntaxHighlighter } from '@/components/ui/media/SimpleSyntaxHighlighter';
import { useCodeSyntaxHighlighting } from '@/components/ui/code/highlighting/useCodeSyntaxHighlighting';
import { evaluateCodeHighlightingBudget, type CodeHighlightingBudgetLimits } from '@/components/ui/code/highlighting/evaluateCodeHighlightingBudget';


interface CommandViewProps {
    command: string;
    prompt?: string;
    stdout?: string | null;
    stderr?: string | null;
    error?: string | null;
    // Legacy prop for backward compatibility
    output?: string | null;
    maxHeight?: number;
    fullWidth?: boolean;
    hideEmptyOutput?: boolean;
    /** Language used to syntax highlight the command line. Defaults to `bash`. */
    language?: string | null;
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        // Tool cards already provide a container; keep this view visually lightweight so it
        // matches other tool outputs in light mode.
        backgroundColor: 'transparent',
        borderRadius: 0,
        overflow: 'visible',
        padding: 0,
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
    },
    line: {
        alignItems: 'baseline',
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    promptText: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.state.success.foreground ?? theme.colors.text.primary,
        fontWeight: '600',
    },
    commandText: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        fontSize: 14,
        color: theme.colors.text.primary,
        lineHeight: 20,
        flex: 1,
    },
    commandHighlightContainer: {
        flex: 1,
        flexShrink: 1,
        // The row aligns the `$` prompt and the command on a shared baseline; a
        // stretched container would top-align the command instead.
        alignSelf: 'baseline',
    },
    outputHighlightContainer: {
        marginTop: 8,
        alignSelf: 'stretch',
    },
    stdout: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        fontSize: 13,
        color: theme.colors.text.primary,
        lineHeight: 18,
        marginTop: 8,
    },
    stderr: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        fontSize: 13,
        color: theme.colors.state.neutral.foreground ?? theme.colors.text.secondary,
        lineHeight: 18,
        marginTop: 8,
    },
    error: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        fontSize: 13,
        color: theme.colors.state.danger.foreground ?? theme.colors.state.danger.foreground ?? theme.colors.text.primary,
        lineHeight: 18,
        marginTop: 8,
    },
    emptyOutput: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        fontSize: 13,
        color: theme.colors.text.secondary,
        lineHeight: 18,
        marginTop: 8,
        fontStyle: 'italic',
    },
}));

/**
 * A stdout/stderr/error block. Highlighting is budget-gated per stream, so a huge
 * log keeps the cheap plain-text path while short output gets tokens.
 */
const CommandOutputStream = React.memo(function CommandOutputStream(props: {
    text: string;
    style: StyleProp<TextStyle>;
    defaultColor?: string;
    textStyle: TextStyle;
    syntaxLanguage: string | null;
    highlightEnabled: boolean;
    budgetLimits: CodeHighlightingBudgetLimits;
}) {
    const budget = React.useMemo(
        () => (props.highlightEnabled && props.syntaxLanguage
            ? evaluateCodeHighlightingBudget(props.text, props.budgetLimits)
            : null),
        [props.budgetLimits, props.highlightEnabled, props.syntaxLanguage, props.text],
    );

    if (props.highlightEnabled && props.syntaxLanguage && budget?.withinBudget === true) {
        return (
            <SimpleSyntaxHighlighter
                code={props.text}
                language={props.syntaxLanguage}
                selectable
                wrap
                defaultColor={props.defaultColor}
                textStyle={props.textStyle}
                containerStyle={stylesheet.outputHighlightContainer}
            />
        );
    }

    return <Text selectable style={props.style}>{props.text}</Text>;
});

export const CommandView = React.memo<CommandViewProps>(({
    command,
    prompt = '$',
    stdout,
    stderr,
    error,
    output,
    maxHeight,
    fullWidth,
    hideEmptyOutput,
    language = 'bash',
}) => {
    // Use legacy output if new props aren't provided
    const hasNewProps = stdout !== undefined || stderr !== undefined || error !== undefined;

    const styles = stylesheet;

    // Same feature flag + budget as the file/diff renderers, so command highlighting
    // turns off together with the rest of the syntax highlighting.
    const syntax = useCodeSyntaxHighlighting({ language });
    const syntaxLanguage = syntax.language;
    const highlightEnabled = syntax.mode !== 'off' && Boolean(syntaxLanguage);

    const budgetLimits = React.useMemo(() => ({
        maxBytes: syntax.maxBytes ?? 0,
        maxLines: syntax.maxLines ?? 0,
        maxLineLength: syntax.maxLineLength ?? 0,
    }), [syntax.maxBytes, syntax.maxLines, syntax.maxLineLength]);

    const commandBudget = React.useMemo(
        () => (highlightEnabled ? evaluateCodeHighlightingBudget(command, budgetLimits) : null),
        [budgetLimits, command, highlightEnabled],
    );

    const highlightCommand = commandBudget?.withinBudget === true;

    // Highlighted and plain text must keep the same face, so command output does not
    // shift fonts when the highlighting setting changes.
    const commandHighlightTextStyle = React.useMemo(() => ({
        fontFamily: styles.commandText.fontFamily,
        fontSize: styles.commandText.fontSize,
        lineHeight: styles.commandText.lineHeight,
    }), [styles]);

    const outputHighlightTextStyle = React.useMemo(() => ({
        fontFamily: styles.stdout.fontFamily,
        fontSize: styles.stdout.fontSize,
        lineHeight: styles.stdout.lineHeight,
    }), [styles]);

    return (
        <View style={[
            styles.container, 
            maxHeight ? { maxHeight } : undefined,
            fullWidth ? { width: '100%' } : undefined
        ]}>
            {/* Command Line */}
            <View style={styles.line}>
                <Text selectable style={styles.promptText}>{prompt} </Text>
                {highlightCommand && syntaxLanguage ? (
                    <SimpleSyntaxHighlighter
                        code={command}
                        language={syntaxLanguage}
                        selectable
                        wrap
                        textStyle={commandHighlightTextStyle}
                        containerStyle={styles.commandHighlightContainer}
                    />
                ) : (
                    <Text selectable style={styles.commandText}>{command}</Text>
                )}
            </View>

            {hasNewProps ? (
                <>
                    {/* Standard Output */}
                    {stdout && stdout.trim() && (
                        <CommandOutputStream
                            text={stdout}
                            style={styles.stdout}
                            defaultColor={styles.stdout.color}
                            textStyle={outputHighlightTextStyle}
                            syntaxLanguage={syntaxLanguage}
                            highlightEnabled={highlightEnabled}
                            budgetLimits={budgetLimits}
                        />
                    )}

                    {/* Standard Error */}
                    {stderr && stderr.trim() && (
                        <CommandOutputStream
                            text={stderr}
                            style={styles.stderr}
                            defaultColor={styles.stderr.color}
                            textStyle={outputHighlightTextStyle}
                            syntaxLanguage={syntaxLanguage}
                            highlightEnabled={highlightEnabled}
                            budgetLimits={budgetLimits}
                        />
                    )}

                    {/* Error Message */}
                    {error && (
                        <CommandOutputStream
                            text={error}
                            style={styles.error}
                            defaultColor={styles.error.color}
                            textStyle={outputHighlightTextStyle}
                            syntaxLanguage={syntaxLanguage}
                            highlightEnabled={highlightEnabled}
                            budgetLimits={budgetLimits}
                        />
                    )}

                    {/* Empty output indicator */}
                    {!stdout && !stderr && !error && !hideEmptyOutput && (
                        <Text selectable style={styles.emptyOutput}>{t('commandView.completedWithNoOutput')}</Text>
                    )}
                </>
            ) : (
                /* Legacy output format */
                output && (
                    <Text selectable style={styles.commandText}>{'\n---\n' + output}</Text>
                )
            )}
        </View>
    );
});
