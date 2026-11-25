import {
  BRANCHES_VI,
  type CalendarMode,
  canonicalJson,
  listProvinces34,
  listProvinces63,
  normalizeBirthTemporal,
  sha256Canonical,
} from '@sovana/geo-time';
import { initGeoTimeBrowser } from '@sovana/geo-time/data';
import { type ChartIR, compileChartIR } from '@sovana/kernel';
import { initKernelBrowser } from '@sovana/kernel/data';
import {
  type InvariantIntersectionReport,
  type QuestionSelectionResult,
  type RectificationState,
  type SolverReportIR,
  type WeightedCandidateReport,
  answerQuestion,
  computeInvariantIntersection,
  createInitialRectificationState,
  evaluateRulesDAG,
  selectNextQuestion,
} from '@sovana/solver';
import { initSolverBrowser } from '@sovana/solver/data';
import {
  PUBLIC_RULES_50,
  SOVANA_LOGO_SVG,
  SOVANA_SHOWCASE_SPECS,
} from 'virtual:sovana-brand';
import { renderStratifiedDagSvg } from './dagSvg.js';
import { renderBaziAndLiuyaoSubcards, renderDualSiloPalaceBoard } from './palaceGrid.js';
import {
  SMOKING_GUN_PRESETS,
  type XrayBirthFormState,
  normalizeLocationInput,
} from './presets.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMsAsSignedMinSec(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  const absSec = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(absSec / 60);
  const s = absSec % 60;
  return `${sign}${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
}

async function computeWebCryptoSha256(canonicalPayload: string): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const bytes = new TextEncoder().encode(canonicalPayload);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Canonical(JSON.parse(canonicalPayload));
}

function initRectifier(candidateBranches?: number[]): RectificationState {
  return createInitialRectificationState(candidateBranches ? { candidateBranches } : {});
}

function selectQuestion(state: RectificationState): QuestionSelectionResult | null {
  return state.status === 'ACTIVE' ? selectNextQuestion(state) : null;
}

function applyAnswer(state: RectificationState, questionId: string, optionId: string): RectificationState {
  return answerQuestion(state, questionId, optionId);
}

function evaluateDag(chart: ChartIR): SolverReportIR {
  return evaluateRulesDAG(chart, PUBLIC_RULES_50);
}

function computeIntersectionForForm(
  form: XrayBirthFormState,
  rectState: RectificationState,
): InvariantIntersectionReport | null {
  const surviving = rectState.candidates.filter((c) => c.probMicro >= 50_000);
  const chosen = surviving.length > 0 ? surviving : rectState.candidates.slice(0, 1);
  if (chosen.length === 0) return null;

  const loc = normalizeLocationInput(form.location);
  const weightedReports: WeightedCandidateReport[] = [];
  let refBazi: ChartIR['bazi'] | null = null;
  for (const cand of chosen) {
    const repHour = cand.shichenBranch === 0 ? 0 : cand.shichenBranch * 2;
    const temp = normalizeBirthTemporal({
      year: form.year,
      month: form.month,
      day: form.day,
      hour: repHour,
      minute: 0,
      location: loc,
      calendarMode: form.calendarMode,
      leapMonthPolicy: form.leapMonthPolicy,
    });
    const cIr = compileChartIR({ temporal: temp, gender: form.gender });
    if (!refBazi) refBazi = cIr.bazi;
    weightedReports.push({
      report: evaluateDag(cIr),
      probMicro: cand.probMicro,
      shichenBranch: cand.shichenBranch,
    });
  }
  if (!refBazi) return null;
  return computeInvariantIntersection(weightedReports, refBazi);
}

let xrayDataInitialized = false;

function decodeBase64Bytes(b64: string): Uint8Array {
  const binStr = atob(b64);
  const out = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    out[i] = binStr.charCodeAt(i);
  }
  return out;
}

function ensureXrayDataInitialized(): void {
  if (xrayDataInitialized) return;
  initGeoTimeBrowser({
    ephemeris: decodeBase64Bytes(SOVANA_SHOWCASE_SPECS.ephemerisBase64),
    geoDataset: SOVANA_SHOWCASE_SPECS.geoDataset,
    tzRegimes: SOVANA_SHOWCASE_SPECS.tzRegimes,
  });
  initKernelBrowser({
    namPhai: SOVANA_SHOWCASE_SPECS.namPhai,
    toanThu: SOVANA_SHOWCASE_SPECS.toanThu,
    bazi: SOVANA_SHOWCASE_SPECS.bazi,
    liuyao: SOVANA_SHOWCASE_SPECS.liuyao,
  });
  initSolverBrowser({
    sampleRules: PUBLIC_RULES_50,
    terminologyVi: SOVANA_SHOWCASE_SPECS.terminologyVi,
  });
  xrayDataInitialized = true;
}

export function mountXrayApp(root: HTMLElement): void {
  ensureXrayDataInitialized();
  // Ensure ?xray=1 telemetry query flag is active on HTTP(S) origins
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('xray') !== '1') {
      url.searchParams.set('xray', '1');
      window.history.replaceState({}, '', url.toString());
    }
  }

  let form: XrayBirthFormState = { ...SMOKING_GUN_PRESETS[0]!.form };
  let selectedDagNodeId: string | null = null;
  let rectState: RectificationState = initRectifier();
  let webCryptoHash = 'computing…';
  let errorBanner: string | null = null;

  const datalistItems = (() => {
    const names = new Set<string>([
      'Hà Nội',
      'Sài Gòn',
      'TP. Hồ Chí Minh',
      'Đà Nẵng',
      'Hà Tây',
      'Gia Định',
      'Hoàng Sa',
      'Trường Sa',
      'Phú Quốc',
      'Côn Đảo',
    ]);
    for (const p34 of listProvinces34()) names.add(p34.shortName);
    for (const p63 of listProvinces63()) names.add(p63.shortName);
    return [...names];
  })();

  const render = (): void => {
    let chart: ChartIR;
    try {
      errorBanner = null;
      const loc = normalizeLocationInput(form.location);
      const mig = normalizeLocationInput(form.migrationDestination);
      const temporal = normalizeBirthTemporal({
        year: form.year,
        month: form.month,
        day: form.day,
        hour: form.hour,
        minute: form.minute,
        location: loc,
        calendarMode: form.calendarMode,
        leapMonthPolicy: form.leapMonthPolicy,
        ...(mig ? { migrationDestination: mig } : {}),
      });
      chart = compileChartIR({
        temporal,
        gender: form.gender,
        castMaiHoa: true,
      });
    } catch (err) {
      errorBanner = err instanceof Error ? err.message : String(err);
      const fallbackTemp = normalizeBirthTemporal({
        year: 1968,
        month: 1,
        day: 29,
        hour: 10,
        minute: 30,
        location: 'Hà Nội',
      });
      chart = compileChartIR({ temporal: fallbackTemp, gender: 'male', castMaiHoa: true });
    }

    const dagReport = evaluateDag(chart);
    const syncHash = sha256Canonical(chart);
    const canonicalPayload = canonicalJson(chart);

    // Trigger live WebCrypto SHA-256 verification
    void computeWebCryptoSha256(canonicalPayload).then((hex) => {
      if (webCryptoHash !== hex) {
        webCryptoHash = hex;
        const el = root.querySelector('#webcrypto-sha256');
        const badge = root.querySelector('#webcrypto-match-badge');
        if (el) el.textContent = hex;
        if (badge) {
          badge.textContent =
            hex === syncHash ? '✓ WEBCRYPTO === KERNEL SHA-256' : '✗ DIGEST MISMATCH';
        }
      }
    });

    const activePreset = SMOKING_GUN_PRESETS.find((p) => p.id === form.presetId) ?? null;

    // Build live Smoking Gun comparison telemetry
    let spotlightDiffHtml = '';
    if (form.presetId === 'tet-mau-than-1968') {
      const vn = chart.temporal.lunarVn;
      const cn = chart.temporal.lunarCn;
      spotlightDiffHtml = `
        <div class="diff-box"><strong>VN_UTC7 (121-CP):</strong> Mồng ${vn.lunarDay}/${vn.lunarMonth} năm ${vn.lunarYear} (Mậu Thân)</div>
        <div class="diff-box warn"><strong>CN_UTC8 (Bắc Kinh):</strong> Ngày ${cn.lunarDay}/${cn.lunarMonth} năm ${cn.lunarYear} (Đinh Mùi)</div>
      `;
    } else if (form.presetId === 'saigon-1968-utc8') {
      const sgTemp = normalizeBirthTemporal({
        year: 1968,
        month: 5,
        day: 15,
        hour: 1,
        minute: 15,
        location: 'Sài Gòn',
      });
      const hnTemp = normalizeBirthTemporal({
        year: 1968,
        month: 5,
        day: 15,
        hour: 1,
        minute: 15,
        location: 'Hà Nội',
      });
      spotlightDiffHtml = `
        <div class="diff-box"><strong>Sài Gòn (${sgTemp.timezone.utcOffsetLabel}):</strong> TST ${sgTemp.trueSolarTime.formattedTime} → Giờ ${sgTemp.trueSolarTime.shichenBranchVi} (${formatMsAsSignedMinSec(sgTemp.trueSolarTime.longitudeCorrectionMs)})</div>
        <div class="diff-box warn"><strong>Hà Nội (${hnTemp.timezone.utcOffsetLabel}):</strong> TST ${hnTemp.trueSolarTime.formattedTime} → Giờ ${hnTemp.trueSolarTime.shichenBranchVi} (${formatMsAsSignedMinSec(hnTemp.trueSolarTime.longitudeCorrectionMs)})</div>
      `;
    } else if (form.presetId === 'can-canh-1980-fork') {
      const mig = chart.temporal.migration;
      spotlightDiffHtml = `
        <div class="diff-box"><strong>Nam Phái:</strong> Thiên Đồng Hóa Khoa · Thái Âm Hóa Kỵ</div>
        <div class="diff-box warn"><strong>Toàn Thư:</strong> Thái Âm Hóa Khoa · Thiên Đồng Hóa Kỵ</div>
        ${mig ? `<div class="diff-box"><strong>Vincenty:</strong> ${(mig.distanceMeters / 1000).toFixed(1)} km · ${mig.forwardAzimuthDeg.toFixed(3)}° (Cung ${mig.palaceBranchVi})</div>` : ''}
      `;
    }

    // Prepare Panel C DAG anchors & selected node details
    const chartAnchorFacts = [
      {
        id: 'IR-STEM',
        label: `Năm ${chart.temporal.pillars.lunarYearPillar.labelVi}`,
        sub: `Can #${chart.temporal.pillars.lunarYearPillar.stemIndex} · TST ${chart.temporal.trueSolarTime.formattedTime}`,
      },
      {
        id: 'IR-NAMPHAI',
        label: `Silo Nam Phái`,
        sub: `Mệnh ${BRANCHES_VI[chart.ziweiNamPhai.menhBranch]} · ${chart.ziweiNamPhai.cucNameVi}`,
      },
      {
        id: 'IR-TOANTHU',
        label: `Silo Toàn Thư`,
        sub: `Forks: ${chart.empiricalForks.forkedStars.length} · ΔBright: ${chart.empiricalForks.brightnessDiffCount}`,
      },
      {
        id: 'IR-BAZI',
        label: `Bát Tự ${chart.bazi.dayMasterStemVi}`,
        sub: `${chart.bazi.dayMasterScoreBps} bps · ${chart.bazi.strengthClass}`,
      },
      {
        id: 'IR-LIUYAO',
        label: chart.liuyao ? `Quẻ ${chart.liuyao.primaryHexagram.nameVi}` : 'Lục Hào (None)',
        sub: chart.liuyao ? `Động: [${chart.liuyao.movingLines.join(',') || 'Tĩnh'}]` : '—',
      },
    ];

    const selectedNode =
      dagReport.nodes.find((n) => n.nodeId === selectedDagNodeId) ?? dagReport.nodes[0] ?? null;
    const selectedConflict =
      dagReport.conflicts.find((c) => c.conflictId === selectedDagNodeId) ?? null;

    // Prepare Panel D Rectification telemetry
    const nextQ = selectQuestion(rectState);
    const entropyBits = (rectState.entropyMillibits / 1000).toFixed(3);
    const entropyPct = Math.min(100, Math.max(0, (rectState.entropyMillibits / 3585) * 100));
    const topRatio =
      rectState.top2ProbMicro > 0
        ? (rectState.top1ProbMicro / rectState.top2ProbMicro).toFixed(2)
        : '∞';
    const intersection =
      rectState.status === 'INVARIANT_INTERSECTION'
        ? computeIntersectionForForm(form, rectState)
        : null;

    const tst = chart.temporal.trueSolarTime;
    const tz = chart.temporal.timezone;
    const loc = chart.temporal.location;
    const unc = chart.temporal.uncertainty;
    const mig = chart.temporal.migration;

    root.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="brand-wrap">
            <div class="brand-logo">${SOVANA_LOGO_SVG}</div>
            <div class="brand-meta">
              <span class="brand-kicker">DEEPTECH ASTRONOMICAL TELEMETRY &amp; STRATIFIED PROOF-DAG INSPECTOR</span>
              <span class="brand-sub">Zero-Float-Drift JPL DE440s Ephemeris · 63↔34 Bi-Temporal GIS · Finite-Ring ℤ₁₀×ℤ₁₂ Kernel · Paraconsistent Solver</span>
            </div>
          </div>
          <div class="topbar-badges">
            <span class="pill emerald"><span class="dot-live"></span> ?xray=1 TELEMETRY ACTIVE</span>
            <span class="pill cyan">SCHEMA v${esc(chart.schemaVersion)}</span>
            <span class="pill gold">MIT OPEN-CORE</span>
          </div>
        </header>

        <section class="presets-section">
          <div class="section-label">
            <span>3 HISTORICAL "SMOKING GUN" VERIFICATION PRESETS</span>
            <span>CLICK PRESET TO RE-COMPILE LIVE IN BROWSER (&lt; 1ms)</span>
          </div>
          <div class="presets-grid">
            ${SMOKING_GUN_PRESETS.map(
              (p) => `
              <button type="button" class="preset-card ${form.presetId === p.id ? 'active' : ''}" data-preset-id="${esc(p.id)}">
                <div class="preset-top">
                  <span class="preset-tag">${esc(p.tag)}</span>
                  <span class="mono" style="font-size:11px;color:var(--accent-cyan);">${p.form.year}-${String(p.form.month).padStart(2, '0')}-${String(p.form.day).padStart(2, '0')}</span>
                </div>
                <div class="preset-title">${esc(p.title)}</div>
                <div class="preset-desc">${esc(p.summary)}</div>
              </button>
            `,
            ).join('')}
          </div>
        </section>

        <form class="control-bar" id="custom-birth-form">
          <div class="field">
            <label for="f-date">Ngày dương lịch</label>
            <input id="f-date" type="date" min="1900-01-01" max="2100-12-31" value="${String(form.year).padStart(4, '0')}-${String(form.month).padStart(2, '0')}-${String(form.day).padStart(2, '0')}" />
          </div>
          <div class="field">
            <label for="f-time">Giờ đồng hồ</label>
            <input id="f-time" type="time" value="${String(form.hour).padStart(2, '0')}:${String(form.minute).padStart(2, '0')}" />
          </div>
          <div class="field">
            <label for="f-gender">Giới tính</label>
            <select id="f-gender">
              <option value="male" ${form.gender === 'male' ? 'selected' : ''}>Nam (Male)</option>
              <option value="female" ${form.gender === 'female' ? 'selected' : ''}>Nữ (Female)</option>
            </select>
          </div>
          <div class="field">
            <label for="f-loc">Nơi sinh (63↔34 / Đảo / Lịch sử)</label>
            <input id="f-loc" list="vn-locations-list" value="${esc(form.location)}" placeholder="Hà Nội, Sài Gòn, Hoàng Sa..." />
          </div>
          <div class="field">
            <label for="f-mig">Nơi lập nghiệp (Vincenty)</label>
            <input id="f-mig" list="vn-locations-list" value="${esc(form.migrationDestination)}" placeholder="Tùy chọn: TP.HCM, Hà Nội..." />
          </div>
          <div class="field">
            <label for="f-cal">Chế độ lịch Sóc</label>
            <select id="f-cal">
              <option value="VN_HISTORICAL" ${form.calendarMode === 'VN_HISTORICAL' ? 'selected' : ''}>VN_HISTORICAL (Auto 121-CP)</option>
              <option value="VN_UTC7" ${form.calendarMode === 'VN_UTC7' ? 'selected' : ''}>VN_UTC7 (105°E)</option>
              <option value="CN_UTC8" ${form.calendarMode === 'CN_UTC8' ? 'selected' : ''}>CN_UTC8 (120°E Bắc Kinh)</option>
            </select>
          </div>
          <button type="submit" class="btn">COMPILE IR ↻</button>
          <datalist id="vn-locations-list">
            ${datalistItems.map((n) => `<option value="${esc(n)}"></option>`).join('')}
          </datalist>
        </form>

        ${
          errorBanner
            ? `<div class="spotlight-banner" style="border-color:var(--accent-crimson);"><div class="spotlight-title" style="color:#FCA5A5;">Lỗi đầu vào: ${esc(errorBanner)}</div></div>`
            : activePreset
              ? `
          <div class="spotlight-banner">
            <div class="spotlight-left">
              <div class="spotlight-title">🔬 ${esc(activePreset.spotlightTitle)}</div>
              <div class="spotlight-detail">${esc(activePreset.spotlightDetail)}</div>
            </div>
            <div class="spotlight-diff">
              ${spotlightDiffHtml}
              ${
                form.presetId === 'tet-mau-than-1968'
                  ? `<button type="button" class="btn secondary" id="btn-toggle-cal">Đổi sang ${form.calendarMode === 'CN_UTC8' ? 'VN_UTC7' : 'CN_UTC8'}</button>`
                  : ''
              }
            </div>
          </div>
        `
              : ''
        }

        <main class="panels-grid">
          <!-- PANEL A -->
          <section class="panel panel-a">
            <div class="panel-header">
              <div class="panel-title-wrap">
                <span class="panel-id">PANEL A</span>
                <h2 class="panel-title">Astronomical &amp; Geodesic Telemetry</h2>
              </div>
              <span class="pill ${unc.isBoundaryAmbiguous ? 'gold' : 'emerald'}">
                ${unc.isBoundaryAmbiguous ? '⚠ BOUNDARY AMBIGUOUS' : '✓ ENVELOPE CLEAR'}
              </span>
            </div>

            <div class="kv-grid">
              <div class="kv-card">
                <span class="kv-label">UT1 / Instant Unix (ms)</span>
                <span class="kv-value">${tst.instantUnixMs}</span>
                <span class="kv-sub">EpochDay: ${tst.trueSolarEpochDay} · Wall: ${esc(chart.temporal.inputEcho.isoWallClock)}</span>
              </div>
              <div class="kv-card">
                <span class="kv-label">True Solar Time (TST)</span>
                <span class="kv-value" style="color:var(--accent-emerald);">${esc(tst.formattedTime)} · Giờ ${esc(tst.shichenBranchVi)}</span>
                <span class="kv-sub">Total Δt: ${formatMsAsSignedMinSec(tst.totalCorrectionMs)} (${tst.totalCorrectionMs} ms)</span>
              </div>
              <div class="kv-card">
                <span class="kv-label">Meeus Equation of Time</span>
                <span class="kv-value">${(tst.eotCentiseconds / 100).toFixed(2)}s (${formatMsAsSignedMinSec(tst.eotMs)})</span>
                <span class="kv-sub">Quantized: ${tst.eotCentiseconds} cs · Tiết khí: ${esc(chart.temporal.solarTerm.termNameVi)}</span>
              </div>
              <div class="kv-card">
                <span class="kv-label">Δt Longitude Shift</span>
                <span class="kv-value" style="color:var(--accent-cyan);">${formatMsAsSignedMinSec(tst.longitudeCorrectionMs)} (${tst.longitudeCorrectionMs} ms)</span>
                <span class="kv-sub">WGS-84: ${loc.lat.toFixed(4)}°N, ${loc.lon.toFixed(4)}°E · Köppen: ${esc(loc.koppenZone ?? '—')}</span>
              </div>
              <div class="kv-card span-2">
                <span class="kv-label">Historical Timezone &amp; 63↔34 GIS Resolution</span>
                <span class="kv-value">${esc(tz.regimeId)} (${esc(tz.utcOffsetLabel)}) · ${esc(loc.canonicalName)}</span>
                <span class="kv-sub">Matched: ${esc(loc.matchedBy)} · 63-Tỉnh: ${esc(loc.province63Name ?? '—')} (${esc(loc.province63Code ?? '—')}) ↔ Sau 2025: ${esc(loc.post2025Name ?? '—')} · ${esc(tz.historicalNote)}</span>
              </div>
              <div class="kv-card">
                <span class="kv-label">JPL DE440s Lunar (VN vs CN)</span>
                <span class="kv-value">VN: ${chart.temporal.lunarVn.lunarDay}/${chart.temporal.lunarVn.lunarMonth}/${chart.temporal.lunarVn.lunarYear}${chart.temporal.lunarVn.isLeapMonth ? ' (Nhuận)' : ''}</span>
                <span class="kv-sub">CN: ${chart.temporal.lunarCn.lunarDay}/${chart.temporal.lunarCn.lunarMonth}/${chart.temporal.lunarCn.lunarYear}${chart.temporal.lunarCn.isLeapMonth ? ' (Nhuận)' : ''} · Active: ${esc(chart.temporal.lunarActive.calendarMode)}</span>
              </div>
              <div class="kv-card">
                <span class="kv-label">Uncertainty &amp; Migration</span>
                <span class="kv-value">${
                  mig
                    ? `${(mig.distanceMeters / 1000).toFixed(2)} km · ${mig.forwardAzimuthDeg.toFixed(3)}° (${esc(mig.palaceBranchVi)})`
                    : `ΔShichen: ${unc.secondsToShichenBoundary}s`
                }</span>
                <span class="kv-sub">${
                  mig
                    ? `Giáp ranh quạt 30°: ${(mig.minSectorBoundaryMilliDeg / 1000).toFixed(3)}° ${mig.isSectorBoundaryAmbiguous ? '⚠' : '✓'}`
                    : `ΔTiết khí: ${unc.minSecondsToTermBoundary}s · Candidates: [${unc.candidateShichenBranches.map((b) => BRANCHES_VI[b]).join(', ')}]`
                }</span>
              </div>
            </div>

            <div class="hash-box">
              <div class="hash-row">
                <span style="color:var(--text-muted);">RFC-8785 CANONICAL SHA-256 (WEBCRYPTO SUBTLE)</span>
                <span id="webcrypto-match-badge" class="pill emerald" style="padding:2px 8px;font-size:10px;">
                  ${webCryptoHash === syncHash ? '✓ WEBCRYPTO === KERNEL SHA-256' : 'VERIFYING…'}
                </span>
              </div>
              <div class="hash-hex" id="webcrypto-sha256">${esc(webCryptoHash === 'computing…' ? syncHash : webCryptoHash)}</div>
            </div>
          </section>

          <!-- PANEL B -->
          <section class="panel panel-b">
            <div class="panel-header">
              <div class="panel-title-wrap">
                <span class="panel-id">PANEL B</span>
                <h2 class="panel-title">Dual-Silo 12-Palace Grid · Bát Tự · Lục Hào</h2>
              </div>
              <div class="silo-tabs">
                <button type="button" class="silo-tab ${form.activeSilo === 'nam-phai' ? 'active' : ''}" data-silo="nam-phai">NAM PHÁI (VN)</button>
                <button type="button" class="silo-tab ${form.activeSilo === 'toan-thu' ? 'active' : ''}" data-silo="toan-thu">TOÀN THƯ (CỔ ĐIỂN)</button>
              </div>
            </div>

            ${renderDualSiloPalaceBoard(chart, form.activeSilo)}
            ${renderBaziAndLiuyaoSubcards(chart)}
          </section>

          <!-- PANEL C -->
          <section class="panel panel-c">
            <div class="panel-header">
              <div class="panel-title-wrap">
                <span class="panel-id">PANEL C</span>
                <h2 class="panel-title">Stratified Proof-DAG &amp; Paraconsistent Conflicts</h2>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <span class="pill cyan">${dagReport.nodes.length} NODES / ${dagReport.totalRulesEvaluated} RULES</span>
                <span class="pill ${dagReport.conflicts.length > 0 ? 'gold' : 'emerald'}">${dagReport.conflicts.length} CONFLICTS</span>
                ${selectedDagNodeId ? `<button type="button" class="btn secondary" id="btn-clear-dag" style="padding:3px 8px;font-size:10.5px;">Clear Trace</button>` : ''}
              </div>
            </div>

            <div class="dag-canvas-wrap">
              ${renderStratifiedDagSvg({
                chartAnchorFacts,
                nodes: dagReport.nodes,
                conflicts: dagReport.conflicts,
                selectedNodeId: selectedDagNodeId,
              })}
            </div>

            <div class="dag-inspector-box">
              ${
                selectedConflict
                  ? `
                  <div class="mono" style="color:var(--accent-gold);font-weight:700;">⚡ PARACONSISTENT CONFLICT · ${esc(selectedConflict.conflictId)} (${esc(selectedConflict.kind)})</div>
                  <div>Miền: <strong class="mono">${esc(selectedConflict.domain)}</strong> · Nhánh thuận: <span class="mono">[${esc(selectedConflict.positiveNodeIds.join(', '))}]</span> ↔ Nhánh nghịch: <span class="mono">[${esc(selectedConflict.negativeNodeIds.join(', '))}]</span></div>
                  <div style="color:var(--text-secondary);">${esc(selectedConflict.resolutionHintVi)}</div>
                `
                  : selectedNode
                    ? `
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="mono" style="color:var(--accent-emerald);font-weight:700;">PROVENANCE AST · ${esc(selectedNode.nodeId)} (Stratum ${selectedNode.stratum} · Depth ${selectedNode.proofDepth} · Silo: ${esc(selectedNode.silo)})</span>
                    <span class="pill ${selectedNode.polarity === 'CAT' ? 'emerald' : selectedNode.polarity === 'HUNG' ? 'crimson' : 'cyan'}">${esc(selectedNode.polarity)} · ${esc(selectedNode.domain)}</span>
                  </div>
                  <div style="color:var(--text-light);font-weight:500;">${esc(selectedNode.claimVi)}</div>
                  ${selectedNode.matchedFacts.length > 0 ? `<div class="mono" style="font-size:11px;color:var(--accent-cyan);">Premises: ${esc(selectedNode.matchedFacts.join(' ∧ '))}${selectedNode.parentNodeIds.length > 0 ? ` · Parents: [${esc(selectedNode.parentNodeIds.join(', '))}]` : ''}</div>` : ''}
                  <div class="mono" style="font-size:11px;color:var(--text-muted);">Nguồn cổ thư: ${esc(selectedNode.classicalSource)} (Click bất kỳ nút nào trên đồ thị SVG để truy vết nhân quả)</div>
                `
                    : `<div style="color:var(--text-muted);">Click vào một nút trên đồ thị SVG để xem chi tiết ProvenanceAST.</div>`
              }
            </div>

            ${
              dagReport.conflicts.length > 0
                ? `
              <div class="conflict-list">
                ${dagReport.conflicts
                  .slice(0, 3)
                  .map(
                    (c) => `
                  <div class="conflict-item">
                    <div class="mono" style="font-weight:700;color:var(--accent-gold);">⚡ ${esc(c.conflictId)} · ${esc(c.kind)} · Domain [${esc(c.domain)}]</div>
                    <div style="color:var(--text-secondary);margin-top:2px;">[${esc(c.positiveNodeIds.join(', '))}] ⊗ [${esc(c.negativeNodeIds.join(', '))}] — ${esc(c.resolutionHintVi)}</div>
                  </div>
                `,
                  )
                  .join('')}
              </div>
            `
                : ''
            }
          </section>

          <!-- PANEL D -->
          <section class="panel panel-d">
            <div class="panel-header">
              <div class="panel-title-wrap">
                <span class="panel-id">PANEL D</span>
                <h2 class="panel-title">Shannon-Entropy Bayesian Disambiguator</h2>
              </div>
              <span class="pill ${rectState.status === 'LOCKED' ? 'emerald' : rectState.status === 'INVARIANT_INTERSECTION' ? 'gold' : 'cyan'}">
                ${esc(rectState.status)}
              </span>
            </div>

            <div class="entropy-meter-card">
              <div style="display:flex;justify-content:space-between;align-items:center;" class="mono">
                <span style="font-size:11.5px;color:var(--text-muted);">SHANNON ENTROPY H(C)</span>
                <span style="font-size:13px;font-weight:700;color:var(--accent-cyan);">${entropyBits} bits (${rectState.entropyMillibits} mbits)</span>
              </div>
              <div class="entropy-bar-track">
                <div class="entropy-bar-fill" style="width:${entropyPct.toFixed(1)}%;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);" class="mono">
                <span>Top-1 P = ${((rectState.top1ProbMicro / 1_000_000) * 100).toFixed(1)}% (Gate ≥ 80.0%)</span>
                <span>Ratio P₁/P₂ = ${topRatio}× (Gate ≥ 3.0×)</span>
              </div>
            </div>

            <div class="posterior-grid">
              ${rectState.candidates
                .map((c) => {
                  const pctProb = (c.probMicro / 10_000).toFixed(1);
                  const isTop = c.probMicro === rectState.top1ProbMicro && c.probMicro > 0;
                  return `
                  <div class="post-row ${isTop ? 'top-1' : ''}">
                    <span>Giờ ${esc(c.shichenBranchVi)}</span>
                    <div class="post-track"><div class="post-fill" style="width:${Math.min(100, Number(pctProb))}%;"></div></div>
                    <span style="text-align:right;">${pctProb}%</span>
                  </div>
                `;
                })
                .join('')}
            </div>

            ${
              rectState.status === 'ACTIVE' && nextQ
                ? `
              <div class="question-box">
                <div style="display:flex;justify-content:space-between;align-items:center;" class="mono">
                  <span style="font-size:10.5px;color:var(--accent-gold);">[${esc(nextQ.question.category)}] · #${rectState.askedQuestionIds.length + 1}/${rectState.maxQuestions}</span>
                  <span style="font-size:10.5px;color:var(--accent-emerald);">E[ΔH] = +${(nextQ.expectedInfoGainMillibits / 1000).toFixed(3)} bits</span>
                </div>
                <div style="font-weight:600;font-size:13px;color:var(--text-light);">${esc(nextQ.question.promptVi)}</div>
                <div class="option-btns">
                  ${nextQ.question.options
                    .map(
                      (opt) => `
                    <button type="button" class="option-btn" data-q-id="${esc(nextQ.questionId)}" data-opt-id="${esc(opt.id)}">
                      ▸ ${esc(opt.labelVi)}
                    </button>
                  `,
                    )
                    .join('')}
                </div>
              </div>
            `
                : rectState.status === 'LOCKED'
                  ? `
              <div class="hash-box">
                <div class="mono" style="font-weight:700;color:var(--accent-emerald);font-size:13px;">
                  🔒 BAYESIAN LOCK ACHIEVED: GIỜ ${esc(BRANCHES_VI[rectState.lockedShichenBranch ?? 0] ?? '')}
                </div>
                <div style="font-size:12px;color:var(--text-secondary);">
                  Xác suất hậu nghiệm đạt ${((rectState.top1ProbMicro / 1_000_000) * 100).toFixed(2)}% (≥ 80%), tỷ số áp đảo ${topRatio}× (≥ 3.0×) sau ${rectState.askedQuestionIds.length} câu hỏi khách quan chống Barnum.
                </div>
              </div>
            `
                  : `
              <div class="invariant-box">
                <div class="mono" style="font-weight:700;color:var(--accent-gold);font-size:12.5px;">
                  🛡 PHANH AN TOÀN BAYES → INVARIANT INTERSECTION MODE
                </div>
                <div style="color:var(--text-secondary);">
                  Chưa vượt ngưỡng P ≥ 80% sau ${rectState.askedQuestionIds.length} câu. Hệ thống từ chối đoán mò và chỉ giữ lại giao thoa bất biến trên ${intersection?.survivingCandidateCount ?? 0} canh giờ ứng viên + 3 trụ Năm–Tháng–Ngày:
                </div>
                <div class="mono" style="font-size:11px;color:var(--text-light);">
                  ${
                    intersection && intersection.invariantClaimsVi.length > 0
                      ? intersection.invariantClaimsVi
                          .slice(0, 3)
                          .map((cl) => `• ${esc(cl)}`)
                          .join('<br/>')
                      : '• Bảo toàn tuyệt đối 3 trụ Năm–Tháng–Ngày Bát Tự &amp; Điều Hậu Cùng Thông Bảo Giám.'
                  }
                </div>
              </div>
            `
            }

            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <button type="button" class="btn secondary" id="btn-rect-reset">Reset 12 Giờ (3.585 bits)</button>
              <button type="button" class="btn secondary" id="btn-rect-boundary">Khởi tạo Cận Biên 2 Giờ (1.000 bit)</button>
              <button type="button" class="btn secondary" id="btn-rect-invariant">Mô phỏng Invariant Intersection</button>
            </div>
          </section>
        </main>
      </div>
    `;

    // Wire interactive DOM handlers
    root.querySelectorAll<HTMLButtonElement>('[data-preset-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-preset-id');
        const found = SMOKING_GUN_PRESETS.find((p) => p.id === pid);
        if (found) {
          form = { ...found.form };
          selectedDagNodeId = null;
          webCryptoHash = 'computing…';
          render();
        }
      });
    });

    const toggleCalBtn = root.querySelector<HTMLButtonElement>('#btn-toggle-cal');
    if (toggleCalBtn) {
      toggleCalBtn.addEventListener('click', () => {
        form = {
          ...form,
          calendarMode: form.calendarMode === 'CN_UTC8' ? 'VN_UTC7' : 'CN_UTC8',
        };
        webCryptoHash = 'computing…';
        render();
      });
    }

    const formEl = root.querySelector<HTMLFormElement>('#custom-birth-form');
    if (formEl) {
      formEl.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const dateVal = (root.querySelector<HTMLInputElement>('#f-date')?.value ?? '1980-08-15').split('-');
        const timeVal = (root.querySelector<HTMLInputElement>('#f-time')?.value ?? '09:30').split(':');
        const genderVal =
          root.querySelector<HTMLSelectElement>('#f-gender')?.value === 'female' ? 'female' : 'male';
        const locVal = root.querySelector<HTMLInputElement>('#f-loc')?.value ?? 'Hà Nội';
        const migVal = root.querySelector<HTMLInputElement>('#f-mig')?.value ?? '';
        const calVal = (root.querySelector<HTMLSelectElement>('#f-cal')?.value ??
          'VN_HISTORICAL') as CalendarMode;

        form = {
          ...form,
          presetId: 'custom',
          year: Number(dateVal[0]),
          month: Number(dateVal[1]),
          day: Number(dateVal[2]),
          hour: Number(timeVal[0]),
          minute: Number(timeVal[1]),
          gender: genderVal,
          location: locVal,
          migrationDestination: migVal,
          calendarMode: calVal,
        };
        selectedDagNodeId = null;
        webCryptoHash = 'computing…';
        render();
      });
    }

    root.querySelectorAll<HTMLButtonElement>('[data-silo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = btn.getAttribute('data-silo') === 'toan-thu' ? 'toan-thu' : 'nam-phai';
        form = { ...form, activeSilo: s };
        render();
      });
    });

    root.querySelectorAll<SVGGElement>('.dag-node').forEach((g) => {
      g.addEventListener('click', () => {
        const nid = g.getAttribute('data-node-id');
        selectedDagNodeId = selectedDagNodeId === nid ? null : nid;
        render();
      });
    });

    const clearDagBtn = root.querySelector<HTMLButtonElement>('#btn-clear-dag');
    if (clearDagBtn) {
      clearDagBtn.addEventListener('click', () => {
        selectedDagNodeId = null;
        render();
      });
    }

    root.querySelectorAll<HTMLButtonElement>('.option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qId = btn.getAttribute('data-q-id');
        const optId = btn.getAttribute('data-opt-id');
        if (qId && optId) {
          rectState = applyAnswer(rectState, qId, optId);
          render();
        }
      });
    });

    root.querySelector<HTMLButtonElement>('#btn-rect-reset')?.addEventListener('click', () => {
      rectState = initRectifier();
      render();
    });

    root.querySelector<HTMLButtonElement>('#btn-rect-boundary')?.addEventListener('click', () => {
      const b = chart.temporal.trueSolarTime.shichenBranch;
      rectState = initRectifier([b, (b + 1) % 12]);
      render();
    });

    root.querySelector<HTMLButtonElement>('#btn-rect-invariant')?.addEventListener('click', () => {
      let s = initRectifier([0, 1, 2]);
      for (let step = 0; step < 5 && s.status === 'ACTIVE'; step++) {
        const sel = selectQuestion(s);
        if (!sel) break;
        // Pick the most neutral / flat-likelihood option so posteriors stay below 80%
        const lastOpt = sel.question.options[sel.question.options.length - 1];
        if (!lastOpt) break;
        s = applyAnswer(s, sel.questionId, lastOpt.id);
      }
      rectState = s;
      render();
    });
  };

  render();
}

if (typeof document !== 'undefined') {
  const appRoot = document.getElementById('app');
  if (appRoot) {
    mountXrayApp(appRoot);
  }
}
