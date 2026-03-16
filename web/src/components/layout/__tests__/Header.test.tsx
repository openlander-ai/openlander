import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => {
  const mockUseState = <T,>(initial: T): [T, (value: T | ((prev: T) => T)) => void] => [
    initial,
    () => {},
  ];
  const mockUseRef = <T,>(initial: T) => ({ current: initial });
  const mockUseEffect = () => {};
  type MockElement = {
    type: unknown;
    props: Record<string, unknown> & { children: unknown[] };
  };
  return {
    useState: mockUseState,
    useRef: mockUseRef,
    useEffect: mockUseEffect,
    default: {
      useState: mockUseState,
      useRef: mockUseRef,
      useEffect: mockUseEffect,
    },
    Fragment: ({ children }: { children?: unknown }) => children,
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): MockElement => ({
      type,
      props: { ...props, children },
    }),
  };
});

import { Header } from '../Header';

vi.mock('@/i18n/context', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
}));

vi.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => {
  return {
    Menu: () => 'Menu',
    Cpu: () => 'Cpu',
    MemoryStick: () => 'MemoryStick',
    Bell: () => 'Bell',
    HardDrive: () => 'HardDrive',
    AlertTriangle: () => 'AlertTriangle',
    AlertCircle: () => 'AlertCircle',
    Info: () => 'Info',
    CheckCircle2: () => 'CheckCircle2',
    XCircle: () => 'XCircle',
    X: () => 'X',
    ExternalLink: () => 'ExternalLink',
    ArrowRight: () => 'ArrowRight',
    Archive: () => 'Archive',
    Container: () => 'Container',
    Network: () => 'Network',
    Server: () => 'Server',
    Activity: () => 'Activity',
    Clock: () => 'Clock',
    Play: () => 'Play',
    Square: () => 'Square',
    RefreshCw: () => 'RefreshCw',
    Trash2: () => 'Trash2',
    Globe: () => 'Globe',
    Globe2: () => 'Globe2',
    Loader2: () => 'Loader2',
    Terminal: () => 'Terminal',
    Settings: () => 'Settings',
    LogOut: () => 'LogOut',
    ChevronDown: () => 'ChevronDown',
    ChevronRight: () => 'ChevronRight',
    ChevronLeft: () => 'ChevronLeft',
    Search: () => 'Search',
    Plus: () => 'Plus',
    MoreVertical: () => 'MoreVertical',
    MoreHorizontal: () => 'MoreHorizontal',
    Edit: () => 'Edit',
    Copy: () => 'Copy',
    Check: () => 'Check',
    Wrench: () => 'Wrench',
  };
});

vi.mock('@/components/icons/Logo', () => ({
  Logo: () => 'Logo',
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: unknown }) => children,
}));

function getTextContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }
  if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: { children?: unknown } };
    if (typeof element.type === 'function') {
      return getTextContent(element.type(element.props));
    }
    if (element.props?.children) {
      return getTextContent(element.props.children);
    }
    if (typeof element.type === 'symbol' && element.props?.children) {
      return getTextContent(element.props.children);
    }
  }
  return '';
}

function findNodeWithTitle(
  node: unknown,
  title: string,
): { type?: unknown; props?: { title?: string; children?: unknown; className?: string } } | null {
  if (node && typeof node === 'object') {
    const element = node as {
      type?: unknown;
      props?: { title?: string; children?: unknown; className?: string };
    };
    if (element.props?.title === title) {
      return element;
    }
    if (Array.isArray(element.props?.children)) {
      for (const child of element.props.children) {
        const found = findNodeWithTitle(child, title);
        if (found) return found;
      }
    } else if (element.props?.children) {
      return findNodeWithTitle(element.props.children, title);
    }
  }
  return null;
}

describe('Header', () => {
  it('renders CPU and Memory stats', () => {
    const stats = {
      cpu: 45,
      memory: { totalMB: 1024, usedMB: 512, usagePercent: 50 },
      uptime: 1000,
    };

    const tree = Header({ stats });

    expect(findNodeWithTitle(tree, 'CPU Usage')).toBeTruthy();
    expect(findNodeWithTitle(tree, 'Memory Usage')).toBeTruthy();
    expect(findNodeWithTitle(tree, 'Disk Usage')).toBeNull();
  });

  it('renders Disk stats when provided', () => {
    const stats = {
      cpu: 45,
      memory: { totalMB: 1024, usedMB: 512, usagePercent: 50 },
      uptime: 1000,
      disk: { totalGB: 100, usedGB: 40, usagePercent: 40 },
    };

    const tree = Header({ stats });

    const diskNode = findNodeWithTitle(tree, 'Disk Usage');
    expect(diskNode).toBeTruthy();
    expect(getTextContent(diskNode)).toContain('40.0G / 100.0G');
    expect(diskNode.props.className).not.toContain('text-warning');
  });

  it('applies warning color when disk usage is high', () => {
    const stats = {
      cpu: 45,
      memory: { totalMB: 1024, usedMB: 512, usagePercent: 50 },
      uptime: 1000,
      disk: { totalGB: 100, usedGB: 85, usagePercent: 85 },
    };

    const tree = Header({ stats });

    const diskNode = findNodeWithTitle(tree, 'Disk Usage');
    expect(diskNode).toBeTruthy();
    expect(diskNode.props.className).toContain('text-warning');
  });
});
