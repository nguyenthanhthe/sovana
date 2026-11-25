import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

function findModulePath(modName) {
  const localChecks = [
    path.join(pkgRoot, 'node_modules', modName, 'package.json'),
    path.join(repoRoot, 'node_modules', modName, 'package.json'),
  ];
  for (const pj of localChecks) {
    if (fs.existsSync(pj)) {
      const req = createRequire(pj);
      return req.resolve(modName);
    }
  }
  const pnpmDir = path.join(repoRoot, 'node_modules/.pnpm');
  if (fs.existsSync(pnpmDir)) {
    const entries = fs.readdirSync(pnpmDir);
    const match = entries.find((e) => e.startsWith(`${modName}@`));
    if (match) {
      const targetDir = path.join(pnpmDir, match, 'node_modules', modName);
      const req = createRequire(path.join(targetDir, 'package.json'));
      return req.resolve(targetDir);
    }
  }
  throw new Error(`Cannot resolve build dependency '${modName}' inside ${repoRoot}`);
}

// 1. Run strict TypeScript typecheck first
const tscPath = (() => {
  const tsMain = findModulePath('typescript');
  return path.join(path.dirname(tsMain), 'tsc.js');
})();

execFileSync(process.execPath, [tscPath, '-p', path.join(pkgRoot, 'tsconfig.json'), '--noEmit'], {
  cwd: pkgRoot,
  stdio: 'inherit',
});

// 2. Load showcase brand assets and offline specs for self-contained dist/index.html
const specsRoot = path.join(repoRoot, 'specs');
const readJsonSpec = (rel) => JSON.parse(fs.readFileSync(path.join(specsRoot, rel), 'utf8'));
const ephemerisBase64 = fs
  .readFileSync(path.join(specsRoot, 'ephemeris/ephemeris_1900_2100.bin'))
  .toString('base64');

const rawSampleRules = readJsonSpec('sample_rules/public_rules_50.json');
const sampleRulesArr = Array.isArray(rawSampleRules)
  ? rawSampleRules
  : (rawSampleRules.rules ?? []);

const showcaseSpecs = {
  ephemerisBase64,
  geoDataset: readJsonSpec('geo/vn_bi_temporal_geo.json'),
  tzRegimes: readJsonSpec('geo/vn_tz_regimes.json'),
  namPhai: readJsonSpec('axioms/nam-phai.json'),
  toanThu: readJsonSpec('axioms/toan-thu.json'),
  bazi: readJsonSpec('axioms/bazi.json'),
  liuyao: readJsonSpec('axioms/liuyao.json'),
  terminologyVi: readJsonSpec('sample_rules/terminology_vi.json'),
};

const logoSvgPath = path.join(repoRoot, 'brand/sovana-logo.svg');
const markSvgPath = path.join(repoRoot, 'brand/sovana-mark.svg');
const logoSvg = fs.existsSync(logoSvgPath) ? fs.readFileSync(logoSvgPath, 'utf8') : '';
const markSvg = fs.existsSync(markSvgPath) ? fs.readFileSync(markSvgPath, 'utf8') : '';

// 3. Bundle with esbuild using pure browser exports (zero node:* shims)
const esbuild = await import(
  path.toNamespacedPath
    ? `file:///${findModulePath('esbuild').replace(/\\/g, '/')}`
    : findModulePath('esbuild')
);

const brandModuleSource = `
  export const SOVANA_LOGO_SVG = ${JSON.stringify(logoSvg)};
  export const SOVANA_MARK_SVG = ${JSON.stringify(markSvg)};
  export const PUBLIC_RULES_50 = ${JSON.stringify(sampleRulesArr)};
  export const SOVANA_SHOWCASE_SPECS = ${JSON.stringify(showcaseSpecs)};
`;

const sovanaBrandPlugin = {
  name: 'sovana-brand-virtual',
  setup(build) {
    build.onResolve({ filter: /^virtual:sovana-brand$/ }, () => ({
      path: 'virtual:sovana-brand',
      namespace: 'sovana-brand',
    }));

    build.onLoad({ filter: /.*/, namespace: 'sovana-brand' }, () => ({
      contents: brandModuleSource,
      loader: 'js',
    }));
  },
};

const bundleResult = await esbuild.build({
  entryPoints: [path.join(pkgRoot, 'src/main.ts')],
  bundle: true,
  platform: 'browser',
  conditions: ['browser', 'import', 'default'],
  mainFields: ['browser', 'module', 'main'],
  tsconfigRaw: '{}',
  format: 'esm',
  target: ['es2022'],
  minify: true,
  write: false,
  plugins: [sovanaBrandPlugin],
});

const jsCode = bundleResult.outputFiles[0].text;
const cssCode = fs.readFileSync(path.join(pkgRoot, 'src/styles.css'), 'utf8');
const htmlTemplate = fs.readFileSync(path.join(pkgRoot, 'index.html'), 'utf8');

const distDir = path.join(pkgRoot, 'dist');
const assetsDir = path.join(distDir, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'app.js'), jsCode, 'utf8');
fs.writeFileSync(path.join(assetsDir, 'styles.css'), cssCode, 'utf8');

const safeInlineJs = jsCode.replace(/<\/script/gi, '<\\/script');
const faviconB64 = Buffer.from(markSvg || logoSvg, 'utf8').toString('base64');

const finalHtml = htmlTemplate
  .replace(
    '<!-- __SOVANA_FAVICON__ -->',
    faviconB64
      ? `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${faviconB64}" />`
      : '',
  )
  .replace('/* __SOVANA_INLINE_CSS__ */', () => cssCode)
  .replace('// __SOVANA_INLINE_JS__', () => safeInlineJs);

fs.writeFileSync(path.join(distDir, 'index.html'), finalHtml, 'utf8');
console.log(
  `[xray-inspector] Built dist/index.html (${(Buffer.byteLength(finalHtml, 'utf8') / 1024).toFixed(1)} KB self-contained, JS ${(Buffer.byteLength(jsCode, 'utf8') / 1024).toFixed(1)} KB)`,
);
