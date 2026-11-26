import { createInterface } from 'node:readline';
import { SOVANA_MCP_TOOLS, callSovanaTool } from './tools.js';

export const MCP_SERVER_NAME = '@sovana/mcp';
export const MCP_SERVER_VERSION = '0.1.0';
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function makeError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  };
}

/**
 * Pure, zero-dependency MCP JSON-RPC 2.0 dispatcher.
 * Returns `null` for JSON-RPC notifications (no `id`), which must not emit a response.
 */
export function handleJsonRpcRequest(raw: unknown): JsonRpcResponse | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return makeError(null, -32600, 'Invalid Request: expected JSON-RPC 2.0 object');
  }
  const req = raw as Partial<JsonRpcRequest>;
  const hasId = Object.prototype.hasOwnProperty.call(req, 'id');
  const id: string | number | null =
    typeof req.id === 'string' || typeof req.id === 'number' || req.id === null ? req.id : null;

  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return hasId ? makeError(id, -32600, 'Invalid Request: missing jsonrpc="2.0" or method') : null;
  }

  // Notifications carry no id and expect no reply
  if (!hasId) {
    return null;
  }

  const params =
    req.params && typeof req.params === 'object' && !Array.isArray(req.params)
      ? req.params
      : {};

  switch (req.method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const negotiated = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION,
          },
          instructions:
            'SOVANA deterministic astronomical ephemeris (NASA JPL DE440s), bi-temporal Vietnam GIS (63<->34 provinces), lunar calendar (VN 121-CP vs CN UTC+8), Zi Wei Dou Shu, Bazi, I-Ching, and Hop Ban calculation engine. Always invoke these tools instead of estimating lunar dates, solar terms, Can-Chi pillars, or star placements.',
        },
      };
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: SOVANA_MCP_TOOLS,
        },
      };

    case 'tools/call': {
      const toolName = typeof params.name === 'string' ? params.name : '';
      const rawArgs =
        params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (!toolName) {
        return makeError(id, -32602, 'Invalid params: missing tool name');
      }
      try {
        const output = callSovanaTool(toolName, rawArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(output, null, 2),
              },
            ],
            structuredContent: output,
            isError: false,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing ${toolName}: ${message}`,
              },
            ],
            isError: true,
          },
        };
      }
    }

    default:
      return makeError(id, -32601, `Method not found: ${req.method}`);
  }
}

/**
 * Starts the MCP server over newline-delimited JSON-RPC 2.0 stdio transport.
 * Strictly writes ONLY JSON-RPC frames to stdout; diagnostics go to stderr.
 */
export function startStdioServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): void {
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`${JSON.stringify(makeError(null, -32700, `Parse error: ${msg}`))}\n`);
      return;
    }
    const response = handleJsonRpcRequest(parsed);
    if (response !== null) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  });
}
