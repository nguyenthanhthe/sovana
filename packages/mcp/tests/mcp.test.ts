import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MCP_SERVER_NAME,
  SOVANA_MCP_TOOLS,
  callSovanaTool,
  handleJsonRpcRequest,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../dist/cli.js');

describe('@sovana/mcp — Zero-Dependency Deterministic MCP Server', () => {
  it('exposes all 6 deterministic tools with valid JSON schemas via MCP JSON-RPC', () => {
    const init = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', clientInfo: { name: 'vitest', version: '1.0' } },
    });
    expect(init?.error).toBeUndefined();
    const initRes = init?.result as { serverInfo: { name: string }; protocolVersion: string };
    expect(initRes.serverInfo.name).toBe(MCP_SERVER_NAME);
    expect(initRes.protocolVersion).toBe('2025-03-26');

    // Notifications return null (no response emitted)
    expect(
      handleJsonRpcRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeNull();

    const list = handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (list?.result as { tools: typeof SOVANA_MCP_TOOLS }).tools;
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual([
      'resolve_vietnam_location',
      'convert_vietnam_calendar',
      'compile_ziwei_chart',
      'compile_bazi_chart',
      'cast_iching_hexagram',
      'compare_charts_hopban',
    ]);
  });

  it('resolves Vietnam 63<->34 locations and detects 1968 Saigon UTC+8 historical timezone & VN/CN lunar divergence', () => {
    const loc = callSovanaTool('resolve_vietnam_location', { query: 'Sài Gòn' }) as {
      resolved: { canonicalName: string; tzZone: string; post2025Id: string };
    };
    expect(loc.resolved.tzZone).toBe('VN_SOUTH_RVN');
    expect(loc.resolved.post2025Id).toBe('tp-ho-chi-minh');

    // Pre-1975 Saigon (1968-05-15 01:15) uses South Vietnam UTC+8 historical regime
    const cal = callSovanaTool('convert_vietnam_calendar', {
      mode: 'solar_to_lunar',
      year: 1968,
      month: 5,
      day: 15,
      hour: 1,
      minute: 15,
      location: 'Sài Gòn',
      calendarMode: 'VN_HISTORICAL',
    }) as {
      temporal: { timezone: { utcOffsetSeconds: number }; lunarVn: { lunarYear: number } };
      sha256: string;
    };
    expect(cal.temporal.timezone.utcOffsetSeconds).toBe(28800);
    expect(cal.temporal.lunarVn.lunarYear).toBe(1968);
    expect(cal.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Known VN UTC+7 vs CN UTC+8 leap-month divergence: 1985-04-16
    const div1985 = callSovanaTool('convert_vietnam_calendar', {
      mode: 'solar_to_lunar',
      year: 1985,
      month: 4,
      day: 16,
      hour: 10,
      location: 'Huế',
      calendarMode: 'VN_UTC7',
    }) as {
      isLunarDivergentVnCn: boolean;
      temporal: {
        lunarVn: { lunarYear: number; lunarMonth: number; lunarDay: number; isLeapMonth: boolean };
      };
    };
    expect(div1985.isLunarDivergentVnCn).toBe(true);

    // Exact bidirectional round-trip lunar -> solar using the Vietnam leap month
    const lv = div1985.temporal.lunarVn;
    const rev = callSovanaTool('convert_vietnam_calendar', {
      mode: 'lunar_to_solar',
      year: lv.lunarYear,
      month: lv.lunarMonth,
      day: lv.lunarDay,
      isLeapMonth: lv.isLeapMonth,
      calendarMode: 'VN_UTC7',
    }) as { solar: { isoDate: string } };
    expect(rev.solar.isoDate).toBe('1985-04-16');
  });

  it('compiles deterministic Zi Wei, Bazi, I-Ching, and Hop Ban synastry cleanly', () => {
    const zw = callSovanaTool('compile_ziwei_chart', {
      year: 1990,
      month: 6,
      day: 15,
      hour: 14,
      minute: 30,
      gender: 'male',
      location: 'Hà Nội',
      silo: 'both',
      targetYear: 2026,
      includePatterns: true,
    }) as {
      chartSha256: string;
      ziwei: { namPhai: { palaces: unknown[] }; toanThu: { palaces: unknown[] } };
      structuredPatterns: unknown[];
    };
    expect(zw.chartSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(zw.ziwei.namPhai.palaces).toHaveLength(12);
    expect(zw.ziwei.toanThu.palaces).toHaveLength(12);
    expect(Array.isArray(zw.structuredPatterns)).toBe(true);

    const bazi = callSovanaTool('compile_bazi_chart', {
      year: 1990,
      month: 6,
      day: 15,
      hour: 14,
      minute: 30,
      gender: 'male',
      location: 'Hà Nội',
    }) as { bazi: { dayMasterStemVi: string; dieuHau: { summaryVi: string } } };
    expect(bazi.bazi.dayMasterStemVi.length).toBeGreaterThan(0);
    expect(bazi.bazi.dieuHau.summaryVi.length).toBeGreaterThan(0);

    const iching = callSovanaTool('cast_iching_hexagram', {
      nowMs: Date.UTC(2026, 10, 26, 9, 0, 0),
      lines: [7, 8, 9, 7, 6, 8],
    }) as { divination: { liuyao: { primaryHexagram: { nameVi: string }; movingLines: number[] } } };
    expect(iching.divination.liuyao.primaryHexagram.nameVi.length).toBeGreaterThan(0);
    expect(iching.divination.liuyao.movingLines).toEqual([3, 5]);

    const hopban = callSovanaTool('compare_charts_hopban', {
      personA: { label: 'A', year: 1992, month: 3, day: 9, hour: 10, gender: 'male', location: 'Hà Nội' },
      personB: { label: 'B', year: 1994, month: 9, day: 21, hour: 16, gender: 'female', location: 'Đà Nẵng' },
      targetYear: 2026,
    }) as { report: { honNhan: { totalScore: number }; hopTac: { totalScore: number } } };
    expect(hopban.report.honNhan.totalScore).toBeGreaterThanOrEqual(0);
    expect(hopban.report.hopTac.totalScore).toBeGreaterThanOrEqual(0);
  });

  it('returns MCP isError=true on invalid tool inputs instead of crashing', () => {
    const res = handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'compile_bazi_chart', arguments: { year: 1800, month: 1, day: 1, hour: 12, gender: 'male' } },
    });
    const payload = res?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain('[1900, 2100]');
  });

  it('speaks valid newline-delimited JSON-RPC 2.0 over real stdio subprocess', async () => {
    const child = spawn(process.execPath, [CLI_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: string[] = [];
    let stderrText = '';
    child.stderr.on('data', (c) => {
      stderrText += String(c);
    });

    const received = new Promise<void>((resolveDone, rejectDone) => {
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += String(chunk);
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          if (p.trim()) lines.push(p.trim());
        }
        if (lines.length >= 2) {
          resolveDone();
        }
      });
      child.on('error', rejectDone);
      setTimeout(() => rejectDone(new Error(`Timed out waiting for stdio MCP replies (got ${lines.length})`)), 8000);
    });

    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'resolve_vietnam_location', arguments: { query: 'Hà Nội' } } })}\n`,
    );
    child.stdin.end();

    await received;
    child.kill();

    expect(stderrText).toBe('');
    expect(lines).toHaveLength(2);
    const initReply = JSON.parse(lines[0]!) as { id: number; result: { serverInfo: { name: string } } };
    const callReply = JSON.parse(lines[1]!) as { id: number; result: { isError: boolean; structuredContent: { resolved: { province63Code: string } } } };
    expect(initReply.id).toBe(1);
    expect(initReply.result.serverInfo.name).toBe('@sovana/mcp');
    expect(callReply.id).toBe(2);
    expect(callReply.result.isError).toBe(false);
    expect(callReply.result.structuredContent.resolved.province63Code).toBe('01');
  });
});
