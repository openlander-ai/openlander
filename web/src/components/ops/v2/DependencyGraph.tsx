import { useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { fetchDependencyGraph } from '@/lib/api/operations';
import type { DependencyNode, DependencyEdge } from '@/lib/api/operations';
import { useLanguage } from '@/i18n/context';
import { Loader2, AlertCircle, Share2 } from 'lucide-react';

const nodeWidth = 200;
const nodeHeight = 60;

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
    return newNode;
  });

  return { nodes: newNodes, edges };
};

export default function DependencyGraph() {
  const { t } = useLanguage();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadGraph() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchDependencyGraph();

        if (!mounted) return;

        const initialNodes: Node[] = data.nodes.map((n: DependencyNode) => {
          let bgColor = 'bg-amber-500/10';
          let borderColor = 'border-amber-500/30';
          let textColor = 'text-amber-500';

          if (n.status === 'running') {
            bgColor = 'bg-green-500/10';
            borderColor = 'border-green-500/30';
            textColor = 'text-green-500';
          } else if (n.status === 'error') {
            bgColor = 'bg-red-500/10';
            borderColor = 'border-red-500/30';
            textColor = 'text-red-500';
          }

          return {
            id: n.id,
            data: {
              label: (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="font-medium text-sm text-foreground truncate w-full text-center px-2">
                    {n.name}
                  </div>
                  <div className={`text-xs mt-1 ${textColor}`}>
                    {n.type === 'project'
                      ? t('opsV2.graph.nodeTypeProject')
                      : t('opsV2.graph.nodeTypeService')}
                  </div>
                </div>
              ),
            },
            position: { x: 0, y: 0 },
            className: `rounded-md border-2 ${bgColor} ${borderColor} shadow-sm`,
            style: { width: nodeWidth, height: nodeHeight },
          };
        });

        const initialEdges: Edge[] = data.edges.map((e: DependencyEdge) => ({
          id: `${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'hsl(var(--muted-foreground))',
          },
          style: { stroke: 'hsl(var(--muted-foreground))' },
        }));

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          initialNodes,
          initialEdges,
          'TB',
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : t('opsV2.errors.loadFailed'));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadGraph();

    return () => {
      mounted = false;
    };
  }, [setNodes, setEdges, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))] text-error p-6 text-center">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p>{error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))] text-center p-6">
        <Share2 className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {t('opsV2.graph.emptyTitle')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('opsV2.graph.emptyDesc')}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))] overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="hsl(var(--border))" gap={16} />
        <Controls className="bg-bg-panel border-[hsl(var(--border))] fill-foreground" />
        <MiniMap
          nodeColor={(n) => {
            const status = (n.data as { status?: string })?.status;
            if (status === 'running') return '#22c55e';
            if (status === 'error' || status === 'exited') return '#ef4444';
            return '#f59e0b';
          }}
          maskColor="hsl(var(--background) / 0.6)"
          className="bg-bg-panel border-[hsl(var(--border))]"
        />
      </ReactFlow>
    </div>
  );
}
