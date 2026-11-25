import type { ChartIR, ZiweiPalaceIR, ZiweiStarIR } from '@sovana/kernel';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSihuaChip(sihua: string | null): string {
  if (!sihua) return '';
  const cls =
    sihua === 'Hóa Lộc'
      ? 'sihua-loc'
      : sihua === 'Hóa Quyền'
        ? 'sihua-quyen'
        : sihua === 'Hóa Khoa'
          ? 'sihua-khoa'
          : 'sihua-ky';
  const short = sihua.replace('Hóa ', '');
  return `<span class="sihua-chip ${cls}">${esc(short)}</span>`;
}

// Traditional 4x4 clockface grid coordinates (row 1..4, col 1..4) for branches 0=Tý .. 11=Hợi
const CLOCKFACE_POS: Record<number, { row: number; col: number }> = {
  5: { row: 1, col: 1 }, // Tỵ
  6: { row: 1, col: 2 }, // Ngọ
  7: { row: 1, col: 3 }, // Mùi
  8: { row: 1, col: 4 }, // Thân
  4: { row: 2, col: 1 }, // Thìn
  9: { row: 2, col: 4 }, // Dậu
  3: { row: 3, col: 1 }, // Mão
  10: { row: 3, col: 4 }, // Tuất
  2: { row: 4, col: 1 }, // Dần
  1: { row: 4, col: 2 }, // Sửu
  0: { row: 4, col: 3 }, // Tý
  11: { row: 4, col: 4 }, // Hợi
};

export function renderDualSiloPalaceBoard(
  chart: ChartIR,
  activeSilo: 'nam-phai' | 'toan-thu',
): string {
  const primary = activeSilo === 'nam-phai' ? chart.ziweiNamPhai : chart.ziweiToanThu;
  const secondary = activeSilo === 'nam-phai' ? chart.ziweiToanThu : chart.ziweiNamPhai;

  const secondaryByBranch = new Map<number, ZiweiPalaceIR>();
  for (const p of secondary.palaces) {
    secondaryByBranch.set(p.branchIndex, p);
  }

  const forkedBranches = new Set<number>(chart.empiricalForks.forkedStars.map((f) => f.branchIndex));

  const renderPalaceCell = (p: ZiweiPalaceIR): string => {
    const pos = CLOCKFACE_POS[p.branchIndex] ?? { row: 1, col: 1 };
    const otherPalace = secondaryByBranch.get(p.branchIndex);
    const otherStarMap = new Map<string, ZiweiStarIR>();
    if (otherPalace) {
      for (const s of [...otherPalace.majorStars, ...otherPalace.minorStars]) {
        otherStarMap.set(s.name, s);
      }
    }

    let hasBrightnessDiff = false;
    const majorHtml = p.majorStars
      .map((s) => {
        const other = otherStarMap.get(s.name);
        const sihuaDiff = other && other.sihuaTransform !== s.sihuaTransform;
        const brightDiff = other && other.brightness !== s.brightness;
        if (brightDiff) hasBrightnessDiff = true;
        const diffHint =
          sihuaDiff && other
            ? `<span class="sihua-chip sihua-khoa" title="Đối chiếu silo kia">≠ ${esc(other.sihuaTransform ?? '∅')}</span>`
            : '';
        return `
          <div class="star-item">
            <span class="star-major">${esc(s.name)} ${s.brightness ? `<span class="star-brightness">[${esc(s.brightness)}${brightDiff && other?.brightness ? `/${esc(other.brightness)}` : ''}]</span>` : ''}</span>
            <span>${renderSihuaChip(s.sihuaTransform)}${diffHint}</span>
          </div>
        `;
      })
      .join('');

    const notableMinor = p.minorStars.filter((s) => s.sihuaTransform !== null || s.category === 'auxiliary' || s.category === 'sha').slice(0, 4);
    const minorHtml = notableMinor
      .map((s) => {
        const other = otherStarMap.get(s.name);
        const sihuaDiff = other && other.sihuaTransform !== s.sihuaTransform;
        return `
          <div class="star-item" style="color: var(--text-muted); font-size: 10.5px;">
            <span>${esc(s.name)}</span>
            <span>${renderSihuaChip(s.sihuaTransform)}${sihuaDiff && other ? `<span class="sihua-chip sihua-ky">≠${esc(other.sihuaTransform ?? '∅')}</span>` : ''}</span>
          </div>
        `;
      })
      .join('');

    const hasFork = forkedBranches.has(p.branchIndex);
    const flags: string[] = [];
    if (p.isMenh) flags.push('MỆNH');
    if (p.isThan) flags.push('THÂN');
    if (p.tuanTrung) flags.push('TUẦN');
    if (p.trietLo) flags.push('TRIỆT');
    if (hasBrightnessDiff && !hasFork) flags.push('ΔĐỘ SÁNG');

    return `
      <div
        class="palace-cell ${p.isMenh ? 'is-menh' : ''} ${hasFork ? 'has-fork' : ''}"
        style="grid-row: ${pos.row}; grid-column: ${pos.col};"
      >
        <div class="palace-top">
          <span class="palace-name">${esc(p.palaceName)}</span>
          <span class="palace-canchi">${esc(p.stemVi)} ${esc(p.branchVi)}</span>
        </div>
        <div class="stars-list">
          ${majorHtml || '<span style="font-size:10.5px;color:#64748B;">(Vô Chính Diệu)</span>'}
          ${minorHtml}
        </div>
        <div class="palace-foot">
          <span>ĐH ${p.daiHanStartAge}–${p.daiHanEndAge}</span>
          <span>${flags.map((f) => `<span class="flag-badge">${esc(f)}</span>`).join(' ')}</span>
        </div>
      </div>
    `;
  };

  const forkSummary = chart.empiricalForks.hasSihuaFork
    ? chart.empiricalForks.forkedStars
        .map(
          (f) =>
            `<div style="font-size:11px;color:var(--accent-gold);" class="mono">⚡ ${esc(f.starName)} (${esc(f.palaceName)}): Nam Phái [${esc(f.namPhaiSihua ?? '∅')}] ↔ Toàn Thư [${esc(f.toanThuSihua ?? '∅')}]</div>`,
        )
        .join('')
    : `<div style="font-size:11px;color:var(--accent-emerald);" class="mono">✓ Đồng thuận Tứ Hóa giữa Nam Phái &amp; Toàn Thư</div>`;

  const centerHtml = `
    <div class="ziwei-center">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;">
          <span class="pill ${chart.empiricalForks.consensusMode ? 'emerald' : 'gold'}">
            ${chart.empiricalForks.consensusMode ? 'ĐỒNG THUẬN ĐA PHÁI' : 'EMPIRICAL FORK ACTIVE'}
          </span>
          <span class="mono" style="font-size:11px;color:var(--accent-cyan);">${esc(primary.cucNameVi)}</span>
        </div>
        <div style="font-size:13px;font-weight:700;margin-bottom:3px;">${esc(primary.siloNameVi)} · ${esc(primary.yinYangLabelVi)}</div>
        <div class="mono" style="font-size:11px;color:var(--text-muted);">
          Bản mệnh: ${esc(primary.banMenhNapAmVi)} · Mệnh chủ: ${esc(primary.menhChuStar)} · Thân chủ: ${esc(primary.thanChuStar)}
        </div>
        <div class="mono" style="font-size:11px;color:var(--text-muted);margin-top:2px;">
          Đối xứng Tử–Phủ: (${primary.tuViBranch} + ${primary.thienPhuBranch}) mod 12 = ${(primary.tuViBranch + primary.thienPhuBranch) % 12} · ΔBrightness: ${chart.empiricalForks.brightnessDiffCount} sao
        </div>
      </div>
      <div style="border-top:1px solid var(--border-subtle);padding-top:6px;">
        ${forkSummary}
      </div>
    </div>
  `;

  return `
    <div class="ziwei-board">
      ${primary.palaces.map(renderPalaceCell).join('\n')}
      ${centerHtml}
    </div>
  `;
}

export function renderBaziAndLiuyaoSubcards(chart: ChartIR): string {
  const bazi = chart.bazi;
  const pct = Math.min(100, Math.max(0, bazi.dayMasterScoreBps / 100));
  const pillars = [
    { label: 'NĂM', p: bazi.yearPillar },
    { label: 'THÁNG', p: bazi.monthPillar },
    { label: 'NGÀY (NHẬT CHỦ)', p: bazi.dayPillar },
    { label: 'GIỜ', p: bazi.hourPillar },
  ];

  const pillarsHtml = pillars
    .map(
      ({ label, p }) => `
      <div class="pillar-box">
        <div class="mono" style="font-size:9.5px;color:var(--text-muted);">${esc(label)}</div>
        <div style="font-size:13px;font-weight:700;color:var(--text-light);margin:2px 0;">${esc(p.pillar.labelVi)}</div>
        <div class="mono" style="font-size:10px;color:var(--accent-cyan);">${esc(p.stemTenGod)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${esc(p.napAmVi)}</div>
      </div>
    `,
    )
    .join('');

  const liuyao = chart.liuyao;
  const liuyaoHtml = liuyao
    ? `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:700;font-size:12.5px;">Lục Hào · ${esc(liuyao.primaryHexagram.nameVi)} → ${esc(liuyao.transformedHexagram.nameVi)}</span>
        <span class="pill cyan">Quẻ #${liuyao.primaryHexagram.kingWenNumber} (${esc(liuyao.primaryHexagram.houseNameVi)})</span>
      </div>
      <div class="hexagram-lines">
        ${liuyao.lines
          .map(
            (ln) => `
          <div class="hex-line-row">
            <span style="width:18px;color:var(--text-muted);">H${ln.lineNumber}</span>
            <span class="hex-bar ${ln.isYang ? 'yang' : 'yin'} ${ln.isMoving ? 'moving' : ''}"></span>
            <span style="width:92px;color:var(--text-light);">${esc(ln.relativeVi)} · ${esc(ln.branchVi)}</span>
            <span style="color:var(--accent-gold);">${ln.isThe ? '[THẾ]' : ln.isUng ? '[ỨNG]' : ''} ${ln.isMoving ? '●Động' : ''} ${ln.isTuanKhong ? '∅TK' : ''}</span>
          </div>
        `,
          )
          .join('')}
      </div>
      <div class="mono" style="font-size:10.5px;color:var(--text-muted);">
        Động hào: [${liuyao.movingLines.join(', ') || 'Tĩnh'}] · Phục thần: ${
          liuyao.phucThan.length > 0
            ? liuyao.phucThan.map((pt) => `${esc(pt.missingRelativeVi)} (${esc(pt.branchVi)} H${pt.lineNumber})`).join(', ')
            : 'Đủ 5 Lục Thân'
        }
      </div>
    `
    : `<div style="color:var(--text-muted);font-size:12px;">Chưa gieo quẻ Lục Hào</div>`;

  return `
    <div class="sub-engines-row">
      <div class="sub-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-weight:700;font-size:12.5px;">Bát Tự Định Lượng · Nhật Chủ ${esc(bazi.dayMasterStemVi)} (${esc(bazi.dayMasterElementVi)})</span>
          <span class="pill ${bazi.strengthClass === 'THAN_VUONG' ? 'emerald' : bazi.strengthClass === 'THAN_NHUOC' ? 'gold' : 'cyan'}">
            ${bazi.dayMasterScoreBps} / 10000 bps · ${esc(bazi.strengthClass)}
          </span>
        </div>
        <div class="strength-bar-track">
          <div class="strength-bar-fill" style="width:${pct.toFixed(1)}%;"></div>
        </div>
        <div class="pillars-row">${pillarsHtml}</div>
        <div style="font-size:11.5px;color:var(--text-secondary);">
          <strong style="color:var(--accent-gold);">Cùng Thông Bảo Giám:</strong> ${esc(bazi.dieuHau.summaryVi)}
          (Dụng thần: <span class="mono">${esc(bazi.dieuHau.primaryGodStemsVi.join(', '))}</span>)
        </div>
        <div class="mono" style="font-size:10.5px;color:var(--text-muted);">${esc(bazi.climateAuditNote)}</div>
      </div>
      <div class="sub-card">
        ${liuyaoHtml}
      </div>
    </div>
  `;
}
