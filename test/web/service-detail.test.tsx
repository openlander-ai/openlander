import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

interface HookDispatcher {
  useState<T>(initial: T | (() => T)): readonly [T, (next: T | ((value: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(callback: T): T;
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  useContext(context: any): any;
  useRef<T>(initialValue: T): { current: T };
  useLayoutEffect(effect: () => void | (() => void), deps?: unknown[]): void;
}

interface ReactClientInternals {
  H: HookDispatcher | null;
}

interface ReactModuleLike {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
}

let ReactModule: ReactModuleLike;
let hookIndex = 0;
const hookSlots: unknown[] = [];

const hookDispatcher: HookDispatcher = {
  useState<T>(initial: T | (() => T)) {
    const slotIndex = hookIndex;
    hookIndex += 1;

    if (hookSlots[slotIndex] === undefined) {
      hookSlots[slotIndex] = initial instanceof Function ? initial() : initial;
    }

    const setState = (next: T | ((value: T) => T)) => {
      const currentValue = hookSlots[slotIndex] as T;
      hookSlots[slotIndex] = next instanceof Function ? next(currentValue) : next;
    };

    const state = hookSlots[slotIndex] as T;
    return [state, setState] as const;
  },
  useCallback(callback) {
    return callback;
  },
  useEffect(effect) {
    // Mock useEffect to do nothing in tests
  },
  useContext(context) {
    return new Proxy(
      {},
      {
        get(target, prop) {
          if (prop === 'matches') return [{ params: { id: '123' } }];
          if (prop === 'pathname') return '/';
          if (prop === 'search') return '';
          if (prop === 'hash') return '';
          if (prop === 'state') return null;
          if (prop === 'key') return 'default';
          if (prop === 'basename') return '/';
          if (prop === 'navigator')
            return { push: vi.fn(), replace: vi.fn(), go: vi.fn(), createHref: vi.fn() };
          if (prop === 'static') return false;
          if (prop === 'location')
            return { pathname: '/', search: '', hash: '', state: null, key: 'default' };
          return undefined;
        },
      },
    );
  },
  useRef(initialValue) {
    const slotIndex = hookIndex;
    hookIndex += 1;
    if (hookSlots[slotIndex] === undefined) {
      hookSlots[slotIndex] = { current: initialValue };
    }
    return hookSlots[slotIndex] as { current: any };
  },
  useLayoutEffect(effect: () => void | (() => void), deps?: unknown[]) {},
};

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: '123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ id: '123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ id: '123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  getService: vi.fn().mockResolvedValue({
    id: '123',
    name: 'test-service',
    image: 'postgres:15',
    status: 'running',
  }),
  startService: vi.fn(),
  stopService: vi.fn(),
  removeService: vi.fn(),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: function Skeleton() {
    return 'Skeleton';
  },
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: function Tabs({ children }: any) {
    return children;
  },
  TabsList: function TabsList({ children }: any) {
    return children;
  },
  TabsTrigger: function TabsTrigger({ children, value }: any) {
    return children;
  },
  TabsContent: function TabsContent({ children, value }: any) {
    return children;
  },
}));

vi.mock('lucide-react', () => ({
  Activity: () => 'ActivityIcon',
  Link: () => 'LinkIcon',
  SquareTerminal: () => 'SquareTerminalIcon',
  Settings: () => 'SettingsIcon',
  AlertTriangle: () => 'AlertTriangleIcon',
  Copy: () => 'CopyIcon',
  Check: () => 'CheckIcon',
  Monitor: () => 'MonitorIcon',
  Key: () => 'KeyIcon',
  Terminal: () => 'TerminalIcon',
  Network: () => 'NetworkIcon',
  Database: () => 'DatabaseIcon',
}));

vi.mock('@/components/service/ServiceOverviewTab', () => ({
  ServiceOverviewTab: function ServiceOverviewTab() {
    return 'Overview Tab Placeholder';
  },
}));

vi.mock('@/components/service/ServiceConnectionTab', () => ({
  ServiceConnectionTab: function ServiceConnectionTab() {
    return 'Connection Tab Placeholder';
  },
}));

vi.mock('@/components/service/ServiceLogsTab', () => ({
  ServiceLogsTab: function ServiceLogsTab() {
    return 'Logs Tab Placeholder';
  },
}));

vi.mock('@/components/service/ServiceSettingsTab', () => ({
  ServiceSettingsTab: function ServiceSettingsTab() {
    return 'Settings Tab Placeholder';
  },
}));

vi.mock('@/components/service/ServiceDatabasesTab', () => ({
  ServiceDatabasesTab: function ServiceDatabasesTab() {
    return 'Databases Tab Placeholder';
  },
}));

vi.mock('@/components/service/ServiceHeader', () => ({
  ServiceHeader: function ServiceHeader() {
    return 'ServiceHeaderComponent';
  },
}));

function findTextInTree(node: any, text: string): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).includes(text);
  }
  if (Array.isArray(node)) {
    return node.some((child) => findTextInTree(child, text));
  }
  if (node && typeof node === 'object' && node.props) {
    if (node.props.children) {
      return findTextInTree(node.props.children, text);
    }
  }
  return false;
}

function findComponentInTree(node: any, typeName: string): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => findComponentInTree(child, typeName));
  }
  if (node && typeof node === 'object') {
    if (typeof node.type === 'function' && node.type.name === typeName) return true;
    if (typeof node.type === 'string' && node.type === typeName) return true;
    if (node.props && node.props.children) {
      return findComponentInTree(node.props.children, typeName);
    }
  }
  return false;
}

let ServiceDetail: typeof import('../../web/src/pages/ServiceDetail.js').ServiceDetail;

function renderDetail() {
  const internals = ReactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = hookDispatcher;
  hookIndex = 0;

  try {
    return ServiceDetail();
  } finally {
    internals.H = previousDispatcher;
  }
}

const describeDetail = isBunRuntime ? describe.skip : describe;

describeDetail('ServiceDetail', () => {
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    ReactModule = require('../../web/node_modules/react/index.js') as ReactModuleLike;
    ({ ServiceDetail } = await import('../../web/src/pages/ServiceDetail.js'));
  });

  beforeEach(() => {
    hookSlots.length = 0;
  });

  it('renders loading skeleton initially', () => {
    // Initial state: service=null, loading=true
    hookSlots[1] = null; // service
    hookSlots[2] = true; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();
    expect(findComponentInTree(tree, 'Skeleton')).toBe(true);
  });

  it('renders not found message when service is null and not loading', () => {
    hookSlots[1] = null; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();
    expect(findTextInTree(tree, 'Service not found')).toBe(true);
  });

  it('renders tabs and header when service is loaded', () => {
    hookSlots[1] = {
      id: '123',
      name: 'test-service',
      image: 'postgres:15',
      status: 'running',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    // Check for ServiceHeader
    expect(findComponentInTree(tree, 'ServiceHeader')).toBe(true);

    // Check for Tab Triggers
    expect(findTextInTree(tree, 'Overview')).toBe(true);
    expect(findTextInTree(tree, 'Connection')).toBe(true);
    expect(findTextInTree(tree, 'Logs')).toBe(true);
    expect(findTextInTree(tree, 'Settings')).toBe(true);
  });

  it('shows Databases tab trigger for PostgreSQL service', () => {
    hookSlots[1] = {
      id: '123',
      name: 'postgres-service',
      image: 'postgres:15',
      status: 'running',
      type: 'postgresql',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    // Verify Databases tab trigger is present
    expect(findTextInTree(tree, 'Databases')).toBe(true);
    // Verify other tabs are still present
    expect(findTextInTree(tree, 'Overview')).toBe(true);
    expect(findTextInTree(tree, 'Connection')).toBe(true);
    expect(findTextInTree(tree, 'Logs')).toBe(true);
    expect(findTextInTree(tree, 'Settings')).toBe(true);
  });

  it('shows Databases tab trigger for MySQL service', () => {
    hookSlots[1] = {
      id: '456',
      name: 'mysql-service',
      image: 'mysql:8',
      status: 'running',
      type: 'mysql',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    // Verify Databases tab trigger is present
    expect(findTextInTree(tree, 'Databases')).toBe(true);
    // Verify other tabs are still present
    expect(findTextInTree(tree, 'Overview')).toBe(true);
    expect(findTextInTree(tree, 'Connection')).toBe(true);
    expect(findTextInTree(tree, 'Logs')).toBe(true);
    expect(findTextInTree(tree, 'Settings')).toBe(true);
  });

  it('does NOT show Databases tab trigger for Redis service', () => {
    hookSlots[1] = {
      id: '789',
      name: 'redis-service',
      image: 'redis:7',
      status: 'running',
      type: 'redis',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    // Verify Databases tab trigger is NOT present
    expect(findTextInTree(tree, 'Databases')).toBe(false);
    // Verify other tabs are still present
    expect(findTextInTree(tree, 'Overview')).toBe(true);
    expect(findTextInTree(tree, 'Connection')).toBe(true);
    expect(findTextInTree(tree, 'Logs')).toBe(true);
    expect(findTextInTree(tree, 'Settings')).toBe(true);
  });

  it('renders Databases tab content for PostgreSQL service', () => {
    hookSlots[1] = {
      id: '123',
      name: 'postgres-service',
      image: 'postgres:15',
      status: 'running',
      type: 'postgresql',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    // Verify Databases tab content component is present in tree (even if not active)
    // The TabsContent with value="databases" should be rendered for postgres
    expect(findComponentInTree(tree, 'ServiceDatabasesTab')).toBe(true);
  });

  it('does NOT render Databases tab content for Redis service', () => {
    hookSlots[1] = {
      id: '789',
      name: 'redis-service',
      image: 'redis:7',
      status: 'running',
      type: 'redis',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'databases'; // activeTab - attempt to set to databases
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    // Verify Databases tab content is NOT rendered
    expect(findTextInTree(tree, 'Databases Tab Placeholder')).toBe(false);
  });

  it('shows Databases tab trigger for MongoDB service', () => {
    hookSlots[1] = {
      id: '790',
      name: 'mongo-service',
      image: 'mongo:7',
      status: 'running',
      type: 'mongodb',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'overview'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    expect(findTextInTree(tree, 'Databases')).toBe(true);
    expect(findTextInTree(tree, 'Overview')).toBe(true);
    expect(findTextInTree(tree, 'Connection')).toBe(true);
    expect(findTextInTree(tree, 'Logs')).toBe(true);
    expect(findTextInTree(tree, 'Settings')).toBe(true);
  });

  it('renders Databases tab component for MongoDB service', () => {
    hookSlots[1] = {
      id: '790',
      name: 'mongo-service',
      image: 'mongo:7',
      status: 'running',
      type: 'mongodb',
    }; // service
    hookSlots[2] = false; // loading
    hookSlots[3] = null; // actionLoading
    hookSlots[4] = 'databases'; // activeTab
    hookSlots[5] = false; // showDeleteDialog
    hookSlots[6] = ''; // deleteConfirmName

    const tree = renderDetail();

    expect(findComponentInTree(tree, 'ServiceDatabasesTab')).toBe(true);
  });
});
