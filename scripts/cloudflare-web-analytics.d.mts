import type { HtmlTagDescriptor, Plugin } from 'vite';

export const CLOUDFLARE_BEACON_URL: string;
export function cloudflareWebAnalyticsTags(env: Record<string, string | undefined>): HtmlTagDescriptor[];
export function cloudflareWebAnalytics(env: Record<string, string | undefined>): Plugin;
