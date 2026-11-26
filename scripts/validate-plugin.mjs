import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..');

const errors = [];
function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

function readJson(relPath) {
  const full = join(ROOT, relPath);
  assert(existsSync(full), `Missing JSON file: ${relPath}`);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (err) {
    errors.push(`Invalid JSON in ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function parseFrontmatter(relPath) {
  const full = join(ROOT, relPath);
  assert(existsSync(full), `Missing markdown file: ${relPath}`);
  if (!existsSync(full)) return { fm: {}, body: '' };
  const raw = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(Boolean(match), `Missing YAML frontmatter in ${relPath}`);
  if (!match) return { fm: {}, body: raw };
  const fm = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      fm[key] = val;
    }
  }
  return { fm, body: match[2] };
}

// 1. Version lockstep across packages, Python, and cross-harness plugin manifests
const rootPkg = readJson('package.json');
const expectedVersion = rootPkg?.version;
assert(typeof expectedVersion === 'string' && /^\d+\.\d+\.\d+$/.test(expectedVersion), `Invalid root version: ${expectedVersion}`);

const pkgFiles = [
  'packages/geo-time/package.json',
  'packages/kernel/package.json',
  'packages/solver/package.json',
  'packages/mcp/package.json',
];
for (const p of pkgFiles) {
  const pkg = readJson(p);
  if (!pkg) continue;
  assert(pkg.version === expectedVersion, `Version mismatch in ${p}: ${pkg.version} !== ${expectedVersion}`);
  assert(pkg.publishConfig?.access === 'public', `Missing publishConfig.access="public" in ${p}`);
  assert(pkg.license === 'MIT', `Expected MIT license in ${p}`);
}

const pyProject = readFileSync(join(ROOT, 'python/sovana/pyproject.toml'), 'utf8');
assert(
  pyProject.includes(`version = "${expectedVersion}"`),
  `Python pyproject.toml version does not match ${expectedVersion}`,
);
const pyInit = readFileSync(join(ROOT, 'python/sovana/src/sovana/__init__.py'), 'utf8');
assert(
  pyInit.includes(`__version__ = "${expectedVersion}"`),
  `Python __init__.py __version__ does not match ${expectedVersion}`,
);

// 2. Cross-harness manifests
const antigravity = readJson('plugin.json');
const geminiExt = readJson('gemini-extension.json');
const mcpConfig = readJson('mcp_config.json');
const dotMcp = readJson('.mcp.json');
const opencode = readJson('opencode.json');
const claudePlugin = readJson('.claude-plugin/plugin.json');
const claudeMarket = readJson('.claude-plugin/marketplace.json');
const cursorPlugin = readJson('.cursor-plugin/plugin.json');

for (const [label, manifest] of [
  ['plugin.json', antigravity],
  ['gemini-extension.json', geminiExt],
  ['.claude-plugin/plugin.json', claudePlugin],
  ['.cursor-plugin/plugin.json', cursorPlugin],
]) {
  if (!manifest) continue;
  assert(manifest.name === 'sovana', `${label} name must be "sovana"`);
  assert(manifest.version === expectedVersion, `${label} version ${manifest.version} !== ${expectedVersion}`);
}

if (antigravity?.logo) {
  assert(existsSync(join(ROOT, antigravity.logo)), `Missing plugin logo: ${antigravity.logo}`);
}
assert(
  claudeMarket?.plugins?.[0]?.version === expectedVersion,
  `.claude-plugin/marketplace.json plugin version mismatch`,
);

// Verify npx -y @sovana/mcp across all MCP manifests
assert(
  mcpConfig?.mcpServers?.sovana?.command === 'npx' &&
    JSON.stringify(mcpConfig?.mcpServers?.sovana?.args) === JSON.stringify(['-y', '@sovana/mcp']),
  'mcp_config.json must configure npx -y @sovana/mcp',
);
assert(
  dotMcp?.mcpServers?.sovana?.command === 'npx' &&
    JSON.stringify(dotMcp?.mcpServers?.sovana?.args) === JSON.stringify(['-y', '@sovana/mcp']),
  '.mcp.json must configure npx -y @sovana/mcp',
);
assert(
  geminiExt?.mcpServers?.sovana?.command === 'npx' &&
    JSON.stringify(geminiExt?.mcpServers?.sovana?.args) === JSON.stringify(['-y', '@sovana/mcp']),
  'gemini-extension.json must configure npx -y @sovana/mcp',
);
assert(
  opencode?.mcp?.sovana?.type === 'local' &&
    JSON.stringify(opencode?.mcp?.sovana?.command) === JSON.stringify(['npx', '-y', '@sovana/mcp']),
  'opencode.json must configure local npx -y @sovana/mcp',
);

// 3. Verify compiled @sovana/mcp exports and tool names
const mcpDist = join(ROOT, 'packages/mcp/dist/index.js');
assert(existsSync(mcpDist), 'packages/mcp/dist/index.js not built — run `pnpm build` first');
let validToolNames = new Set();
if (existsSync(mcpDist)) {
  const mcpMod = await import(pathToFileURL(mcpDist).href);
  assert(
    mcpMod.MCP_SERVER_VERSION === expectedVersion,
    `MCP_SERVER_VERSION (${mcpMod.MCP_SERVER_VERSION}) !== ${expectedVersion}`,
  );
  validToolNames = new Set(mcpMod.SOVANA_MCP_TOOLS.map((t) => t.name));
  assert(validToolNames.size === 6, `Expected 6 MCP tools, got ${validToolNames.size}`);
}

// 4. Validate skills, commands, agents, and rules
const expectedSkills = ['thay-tu-vi', 'thay-dinh-gio', 'thay-bat-tu', 'thay-gieo-que', 'thay-hop-ban'];
const actualSkills = readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
assert(
  JSON.stringify(actualSkills) === JSON.stringify([...expectedSkills].sort()),
  `Expected skills ${expectedSkills.join(', ')}, found ${actualSkills.join(', ')}`,
);

const docsToAudit = ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md', 'rules/AGENTS.md'];

for (const skill of expectedSkills) {
  const rel = `skills/${skill}/SKILL.md`;
  docsToAudit.push(rel);
  const { fm, body } = parseFrontmatter(rel);
  assert(fm.name === skill, `${rel} frontmatter name "${fm.name}" !== "${skill}"`);
  assert(typeof fm.description === 'string' && fm.description.length >= 40, `${rel} description too short`);
  const mentionedTools = [...validToolNames].filter((t) => body.includes(t));
  assert(mentionedTools.length >= 1, `${rel} must reference at least one @sovana/mcp tool`);
}

const expectedCommands = ['tu-vi.md', 'dinh-gio.md', 'bat-tu.md', 'gieo-que.md', 'hop-ban.md'];
for (const cmd of expectedCommands) {
  const rel = `commands/${cmd}`;
  docsToAudit.push(rel);
  const { fm, body } = parseFrontmatter(rel);
  assert(typeof fm.description === 'string' && fm.description.length >= 20, `${rel} description too short`);
  const mentionedTools = [...validToolNames].filter((t) => body.includes(t));
  assert(mentionedTools.length >= 1, `${rel} must reference at least one @sovana/mcp tool`);
}

const expectedAgents = ['sovana-diviner.md', 'sovana-rectifier.md'];
for (const ag of expectedAgents) {
  const rel = `agents/${ag}`;
  docsToAudit.push(rel);
  const { fm } = parseFrontmatter(rel);
  assert(fm.name === ag.replace(/\.md$/, ''), `${rel} frontmatter name mismatch`);
  assert(typeof fm.description === 'string' && fm.description.length >= 30, `${rel} description too short`);
}

// 5. Clean-room MIT & zero-PII audit across all plugin markdown & manifest files
const forbiddenPatterns = [
  /ni[\s_-]?haixia/i,
  /nihai/i,
  /v4\.0-13d/i,
  /rectification-bank/i,
  /vanmenh\/kb/i,
  /\/mnt\/[a-z]\//i,
  /[a-z]:\\tuvi-master/i,
  /cc\s*by-nc-sa/i,
];

const filesToScan = [
  ...docsToAudit,
  'plugin.json',
  'gemini-extension.json',
  'mcp_config.json',
  '.mcp.json',
  'opencode.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.cursor-plugin/plugin.json',
];

for (const rel of filesToScan) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, 'utf8');
  for (const pat of forbiddenPatterns) {
    if (rel === 'AGENTS.md' && pat.source.includes('cc\\s*by-nc-sa')) continue;
    assert(!pat.test(text), `Clean-room violation in ${rel}: matched ${pat}`);
  }
}

if (errors.length > 0) {
  console.error(`SOVANA plugin validation FAILED (${errors.length} error(s)):`);
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `SOVANA plugin validation PASSED — v${expectedVersion} · 8 cross-harness manifests · ${expectedSkills.length} skills · ${expectedCommands.length} commands · ${expectedAgents.length} agents · ${validToolNames.size} MCP tools`,
);
