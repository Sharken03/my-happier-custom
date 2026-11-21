export type HappierBuiltInToolDefinition = Readonly<{
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  annotations?: Readonly<{
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  }>;
}>;

/** An MCP tool-result content block that a tool returns next to its JSON result. */
export type HappierToolResultContentBlock = Readonly<{ type: 'image'; data: string; mimeType: string }>;

export type HappierBuiltInToolDispatchResult =
  | Readonly<{ ok: true; result: unknown; content?: readonly HappierToolResultContentBlock[] }>
  | Readonly<{ ok: false; errorCode: string; error: string; candidates?: string[]; details?: unknown }>;
