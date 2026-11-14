/** Smoke test for the MCP server: lists its tools and calls the read-only ones over stdio. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--experimental-strip-types', new URL('./mcp.ts', import.meta.url).pathname],
  env: process.env as Record<string, string>,
});
const c = new Client({ name: 'tally-smoke', version: '1.0.0' });
await c.connect(transport);
const { tools } = await c.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));
const status = await c.callTool({ name: 'tally_status', arguments: {} });
console.log((status.content as any)[0].text.slice(0, 400));
const menuUrl = `${process.env.TALLY_MENU_BASE ?? 'http://localhost:8787'}/menu/cafe`;
const menu = await c.callTool({ name: 'tally_menu', arguments: { menu_url: menuUrl } });
console.log((menu.content as any)[0].text.slice(0, 500));
const q = await c.callTool({ name: 'tally_quote_topup', arguments: { from: 'base', usd: 20 } });
console.log((q.content as any)[0].text);
await c.close();
