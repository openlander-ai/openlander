import { getRendererForTool } from '../shared/ToolResultRenderers';

export { maskSecrets } from '../shared/ToolResultRenderers';

export function ToolResultContent({ toolName, result }: { toolName: string; result: unknown }) {
  const Renderer = getRendererForTool(toolName);
  return <Renderer result={result} />;
}
