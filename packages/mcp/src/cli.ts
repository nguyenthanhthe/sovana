#!/usr/bin/env node
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, startStdioServer } from './server.js';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${MCP_SERVER_NAME} ${MCP_SERVER_VERSION}\n`);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    `${MCP_SERVER_NAME} ${MCP_SERVER_VERSION}\n` +
      'Zero-dependency MCP stdio server for SOVANA deterministic Vietnamese astronomical calendar, GIS, Zi Wei Dou Shu, Bazi, I-Ching & Hop Ban.\n' +
      'Usage: sovana-mcp [--version | --help]\n' +
      'Connect via any MCP host (Claude Desktop, Cursor, Windsurf, Antigravity) using stdio transport.\n',
  );
  process.exit(0);
}

startStdioServer();
