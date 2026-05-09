import { vi } from 'vitest';

// Mock lucide-react globally to avoid Vite resolution issues
vi.mock('lucide-react', () => ({
  Search: () => 'Search',
  ArrowDown: () => 'ArrowDown',
  Trash2: () => 'Trash2',
  Radio: () => 'Radio',
  RefreshCw: () => 'RefreshCw',
  ExternalLink: () => 'ExternalLink',
  AlertCircle: () => 'AlertCircle',
  CheckCircle2: () => 'CheckCircle2',
  Wrench: () => 'Wrench',
  MessageCircle: () => 'MessageCircle',
  Activity: () => 'Activity',
}));
