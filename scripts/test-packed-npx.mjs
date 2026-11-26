import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const PKG_DIRS = ['packages/geo-time', 'packages/kernel', 'packages/solver', 'packages/mcp'];

function runCmd(cmd, args, cwd) {
  const res = IS_WIN
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [cmd, ...args].join(' ')], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawnSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  if (res.status !== 0) {
    throw new Error(
      `Command failed (${cmd} ${args.join(' ')}) in ${cwd}:\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`,
    );
  }
  return res.stdout.trim();
}

const workDir = mkdtempSync(join(tmpdir(), 'sovana-packed-npx-'));
try {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const version = rootPkg.version;
  const tarballs = {};

  // 1. Pack all 4 workspace packages with pnpm pack (rewrites workspace:* -> exact semver)
  for (const relDir of PKG_DIRS) {
    const pkgDir = join(ROOT, relDir);
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    runCmd('pnpm', ['pack', '--pack-destination', workDir], pkgDir);
    const tgzName = `${pkgJson.name.replace('@', '').replace('/', '-')}-${version}.tgz`;
    tarballs[pkgJson.name] = tgzName;
  }

  // 2. Install packed tarballs in an isolated directory OUTSIDE the monorepo (100% offline)
  const testPkg = {
    name: 'sovana-offline-npx-smoke',
    private: true,
    dependencies: {
      '@sovana/mcp': `file:./${tarballs['@sovana/mcp']}`,
    },
    overrides: {
      '@sovana/geo-time': `file:./${tarballs['@sovana/geo-time']}`,
      '@sovana/kernel': `file:./${tarballs['@sovana/kernel']}`,
      '@sovana/solver': `file:./${tarballs['@sovana/solver']}`,
    },
  };
  writeFileSync(join(workDir, 'package.json'), `${JSON.stringify(testPkg, null, 2)}\n`, 'utf8');
  runCmd('npm', ['install', '--offline', '--no-audit', '--no-fund'], workDir);

  // 3. Verify packed @sovana/mcp/package.json has zero leftover `workspace:` references
  const installedMcpPkg = JSON.parse(
    readFileSync(join(workDir, 'node_modules', '@sovana', 'mcp', 'package.json'), 'utf8'),
  );
  for (const [dep, spec] of Object.entries(installedMcpPkg.dependencies ?? {})) {
    if (String(spec).startsWith('workspace:')) {
      throw new Error(`Packed @sovana/mcp still contains workspace protocol for ${dep}: ${spec}`);
    }
  }

  // 4. Verify CLI via npx --no-install sovana-mcp --version
  const verOut = runCmd('npx', ['--no-install', 'sovana-mcp', '--version'], workDir);
  if (verOut !== `@sovana/mcp ${version}`) {
    throw new Error(`Unexpected version output from packed CLI: "${verOut}" (expected "@sovana/mcp ${version}")`);
  }

  // 5. Execute real stdio JSON-RPC 2.0 calls across ALL 6 tools from outside the monorepo
  const cliPath = join(workDir, 'node_modules', '@sovana', 'mcp', 'dist', 'cli.js');
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'resolve_vietnam_location', arguments: { query: 'Sài Gòn' } },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'convert_vietnam_calendar',
        arguments: { year: 1968, month: 5, day: 15, hour: 1, minute: 15, location: 'Sài Gòn' },
      },
    },
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'compile_ziwei_chart',
        arguments: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, gender: 'male', location: 'Hà Nội', silo: 'both', targetYear: 2026 },
      },
    },
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'compile_bazi_chart',
        arguments: { year: 1985, month: 4, day: 16, hour: 10, gender: 'female', location: 'Huế' },
      },
    },
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'cast_iching_hexagram',
        arguments: { nowMs: Date.UTC(2026, 10, 26, 9, 0, 0), lines: [7, 8, 9, 7, 6, 8] },
      },
    },
    {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'compare_charts_hopban',
        arguments: {
          personA: { label: 'A', year: 1992, month: 3, day: 9, hour: 10, gender: 'male', location: 'Hà Nội' },
          personB: { label: 'B', year: 1994, month: 9, day: 21, hour: 16, gender: 'female', location: 'Đà Nẵng' },
          targetYear: 2026,
        },
      },
    },
  ];

  const replies = await new Promise((resolveDone, rejectDone) => {
    const child = spawn(process.execPath, [cliPath], { cwd: workDir, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let buf = '';
    let errBuf = '';
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    child.stderr.on('data', (c) => {
      errBuf += String(c);
    });
    child.stdout.on('data', (chunk) => {
      buf += String(chunk);
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const p of parts) {
        if (p.trim()) out.push(JSON.parse(p.trim()));
      }
      if (out.length === 8) {
        child.kill();
      }
    });
    child.on('close', () => {
      if (out.length === 8) {
        if (errBuf) finish(rejectDone, new Error(`Unexpected stderr: ${errBuf}`));
        else finish(resolveDone, out);
      } else {
        finish(rejectDone, new Error(`Child exited early with ${out.length}/8 replies; stderr=${errBuf}`));
      }
    });
    child.on('error', (err) => finish(rejectDone, err));
    const timer = setTimeout(() => {
      child.kill();
      finish(rejectDone, new Error(`Timed out waiting for 8 replies (got ${out.length}); stderr=${errBuf}`));
    }, 10000);
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
    child.stdin.end();
  });

  if (replies[0].result.serverInfo.version !== version) {
    throw new Error(`Packed MCP server version mismatch: ${replies[0].result.serverInfo.version}`);
  }
  if (replies[1].result.tools.length !== 6) {
    throw new Error(`Expected 6 MCP tools, got ${replies[1].result.tools.length}`);
  }
  for (let i = 2; i < replies.length; i++) {
    if (replies[i].result.isError) {
      throw new Error(`Tool call id=${replies[i].id} returned isError=true: ${replies[i].result.content[0]?.text}`);
    }
  }
  if (replies[3].result.structuredContent.temporal.timezone.utcOffsetSeconds !== 28800) {
    throw new Error('1968 Saigon UTC+8 historical timezone failed in standalone packed tarball!');
  }
  if (!/^[0-9a-f]{64}$/.test(replies[4].result.structuredContent.chartSha256)) {
    throw new Error('Packed Zi Wei chartSha256 missing or invalid!');
  }

  console.log(
    `Standalone packed tarball & offline npx smoke test PASSED — @sovana/mcp@${version} (all 6 tools + DE440s ephemeris + bundled axioms verified outside monorepo)`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
