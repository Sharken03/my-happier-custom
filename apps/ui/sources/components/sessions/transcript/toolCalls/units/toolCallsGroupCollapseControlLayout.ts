/**
 * Layout of the bottom collapse control in a Tool calls group footer. The control's styles and
 * the row height model both read these values, so the modelled height is the painted height.
 */
export const TOOL_CALLS_GROUP_COLLAPSE_CONTROL_LAYOUT = {
    paddingVerticalPx: 6,
    textLineHeightPx: 18,
    iconSizePx: 16,
} as const;

export function resolveToolCallsGroupCollapseControlHeightPx(): number {
    const layout = TOOL_CALLS_GROUP_COLLAPSE_CONTROL_LAYOUT;
    return layout.paddingVerticalPx * 2 + Math.max(layout.textLineHeightPx, layout.iconSizePx);
}
