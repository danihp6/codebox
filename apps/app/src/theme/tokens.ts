export const THEME_TOKENS = Object.freeze({
  bg: '#0b0f14',
  surface: '#121821',
  text: '#e6edf3',
  muted: '#8b98a5',
  accent: '#22c55e',
  warn: '#f59e0b',
  danger: '#ef4444',
  radius: '12px',
  space: '4px',
  fontMono: "ui-monospace, sfmono-regular, menlo, consolas, 'Liberation Mono', monospace",
  fontSans: "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', roboto, sans-serif",
});

export type ThemeToken = keyof typeof THEME_TOKENS;
