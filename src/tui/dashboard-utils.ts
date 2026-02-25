/**
 * Pure utility functions and constants for the DashboardPanel TUI component.
 * These functions have no side effects and are easily testable.
 */
import { theme } from './theme.js';

// Status icons and colors for projects
export const PROJECT_STATUS_ICON: Record<string, string> = {
  running: '●',
  building: '◐',
  stopped: '○',
  error: '✖',
};

export const PROJECT_STATUS_COLOR: Record<string, string> = {
  running: theme.statusRunning,
  building: theme.statusBuilding,
  stopped: theme.statusStopped,
  error: theme.statusError,
};

// Activity type icons and colors
export const ACTIVITY_ICON: Record<string, string> = {
  success: '✅',
  progress: '🔄',
  error: '❌',
  info: 'ℹ️',
};

export const ACTIVITY_COLOR: Record<string, string> = {
  success: theme.success,
  progress: theme.progress,
  error: theme.error,
  info: theme.info,
};

/**
 * Create a 3-char bar for percentage display.
 * @param percent - Value from 0-100
 * @returns A 3-character string like '◻◻◻', '◼◻◻', '◼◼◻', or '◼◼◼'
 */
export function miniBar(percent: number): string {
  const filled = Math.round(percent / 33.33);
  const blocks = filled >= 3 ? '◼◼◼' : filled === 2 ? '◼◼◻' : filled === 1 ? '◼◻◻' : '◻◻◻';
  return blocks;
}

/**
 * Get color based on percentage threshold.
 * @param percent - Value from 0-100
 * @returns A color string from the theme
 */
export function getColorForPercent(percent: number): string {
  if (percent > 80) return theme.resourceCrit;
  if (percent > 60) return theme.resourceWarn;
  return theme.resourceOk;
}

/**
 * Format memory from MB to GB with 1 decimal place.
 * @param mb - Memory in megabytes
 * @returns Formatted string like '1.0', '2.5', etc.
 */
export function formatMemory(mb: number): string {
  const gb = mb / 1024;
  return gb.toFixed(1);
}

/**
 * Format uptime in seconds to human-readable format.
 * @param seconds - Uptime in seconds
 * @returns Formatted string like '1d 2h' or '3h 45m'
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${String(days)}d ${String(hours)}h`;
  }
  return `${String(hours)}h ${String(mins)}m`;
}

/**
 * Truncate string with ellipsis if it exceeds max length.
 * @param str - String to truncate
 * @param maxLen - Maximum length (including ellipsis)
 * @returns Truncated string with '...' or original if within limit
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Format timestamp to HH:MM format.
 * @param timestamp - ISO timestamp string
 * @returns Formatted time like '14:30'
 */
export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

/**
 * Get activity icon based on message content.
 * @param message - Activity message to analyze
 * @returns Appropriate emoji icon
 */
export function getActivityIcon(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('failed')) return ACTIVITY_ICON['error'] ?? 'ℹ️';
  if (lower.includes('started') || lower.includes('building') || lower.includes('progress'))
    return ACTIVITY_ICON['progress'] ?? 'ℹ️';
  if (
    lower.includes('success') ||
    lower.includes('deployed') ||
    lower.includes('updated') ||
    lower.includes('completed')
  )
    return ACTIVITY_ICON['success'] ?? 'ℹ️';
  return ACTIVITY_ICON['info'] ?? 'ℹ️';
}

/**
 * Get activity color based on message content.
 * @param message - Activity message to analyze
 * @returns Appropriate color string from theme
 */
export function getActivityColor(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('failed')) return ACTIVITY_COLOR['error'] ?? 'cyan';
  if (lower.includes('started') || lower.includes('building') || lower.includes('progress'))
    return ACTIVITY_COLOR['progress'] ?? 'cyan';
  if (
    lower.includes('success') ||
    lower.includes('deployed') ||
    lower.includes('updated') ||
    lower.includes('completed')
  )
    return ACTIVITY_COLOR['success'] ?? 'cyan';
  return ACTIVITY_COLOR['info'] ?? 'cyan';
}
