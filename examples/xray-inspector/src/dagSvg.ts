export interface GenericProvenanceNode {
  nodeId: string;
  silo: string;
  stratum: number;
  domain: string;
  polarity: string;
  claimVi: string;
  classicalSource: string;
  proofDepth?: number;
  parentNodeIds?: readonly string[];
  matchedFacts?: readonly string[];
  premises?: readonly string[];
  dependsOnNodeIds?: readonly string[];
}

export interface GenericConflict {
  conflictId: string;
  domain: string;
  kind: string;
  positiveNodeIds: readonly string[];
  negativeNodeIds: readonly string[];
  resolutionHintVi: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function extractNodeDependencies(node: GenericProvenanceNode): string[] {
  const deps: string[] = [];
  if (Array.isArray(node.parentNodeIds)) {
    for (const id of node.parentNodeIds) {
      if (typeof id === 'string' && !deps.includes(id)) deps.push(id);
    }
  }
  if (Array.isArray(node.dependsOnNodeIds)) {
    for (const id of node.dependsOnNodeIds) {
      if (typeof id === 'string' && !deps.includes(id)) deps.push(id);
    }
  }
  if (Array.isArray(node.premises)) {
    for (const p of node.premises) {
      if (typeof p === 'string') {
        // Match rule IDs like NP-001, TT-014, BZ-003, LY-002, CR-001 or direct node IDs
        const m = /\b([A-Z]{2,4}-\d{2,4})\b/.exec(p);
        if (m && m[1] && !deps.includes(m[1])) deps.push(m[1]);
        else if (!p.includes(' ') && p.includes('-') && !deps.includes(p)) deps.push(p);
      }
    }
  }
  return deps;
}

export interface DagRenderOptions {
  chartAnchorFacts: readonly { id: string; label: string; sub: string }[];
  nodes: readonly GenericProvenanceNode[];
  conflicts: readonly GenericConflict[];
  selectedNodeId: string | null;
}

export function renderStratifiedDagSvg(opts: DagRenderOptions): string {
  const { chartAnchorFacts, nodes, conflicts, selectedNodeId } = opts;

  const stratum1 = nodes.filter((n) => n.stratum <= 1);
  const stratum2 = nodes.filter((n) => n.stratum >= 2);

  const maxRows = Math.max(chartAnchorFacts.length, stratum1.length, stratum2.length + conflicts.length, 4);
  const rowGap = 54;
  const topPad = 48;
  const svgHeight = Math.max(300, topPad + maxRows * rowGap + 24);
  const svgWidth = 820;

  const colX = {
    s0: 20,
    s1: 285,
    s2: 560,
  };
  const boxW = 225;
  const boxH = 40;

  interface PlacedBox {
    id: string;
    x: number;
    y: number;
    col: 0 | 1 | 2;
    title: string;
    sub: string;
    stroke: string;
    fill: string;
    badge: string;
  }

  const placed = new Map<string, PlacedBox>();

  chartAnchorFacts.forEach((f, idx) => {
    const y = topPad + idx * rowGap;
    placed.set(f.id, {
      id: f.id,
      x: colX.s0,
      y,
      col: 0,
      title: f.label,
      sub: f.sub,
      stroke: '#06B6D4',
      fill: '#0D1829',
      badge: 'IR',
    });
  });

  const conflictNodeSet = new Set<string>();
  for (const c of conflicts) {
    for (const id of c.positiveNodeIds) conflictNodeSet.add(id);
    for (const id of c.negativeNodeIds) conflictNodeSet.add(id);
  }

  const placeRuleNode = (n: GenericProvenanceNode, idx: number, col: 1 | 2): void => {
    const x = col === 1 ? colX.s1 : colX.s2;
    const y = topPad + idx * rowGap;
    const inConflict = conflictNodeSet.has(n.nodeId);
    const stroke = inConflict
      ? '#D4AF37'
      : n.polarity === 'CAT'
        ? '#10B981'
        : n.polarity === 'HUNG'
          ? '#EF4444'
          : '#06B6D4';
    const fill = inConflict ? '#1E1A0F' : '#0E1525';
    placed.set(n.nodeId, {
      id: n.nodeId,
      x,
      y,
      col,
      title: `${n.nodeId} · ${n.silo}`,
      sub: truncate(n.claimVi, 28),
      stroke,
      fill,
      badge: `S${n.stratum}`,
    });
  };

  stratum1.forEach((n, idx) => placeRuleNode(n, idx, 1));
  stratum2.forEach((n, idx) => placeRuleNode(n, idx, 2));

  conflicts.forEach((c, idx) => {
    const rowIdx = stratum2.length + idx;
    const y = topPad + rowIdx * rowGap;
    placed.set(c.conflictId, {
      id: c.conflictId,
      x: colX.s2,
      y,
      col: 2,
      title: `⚡ ${c.conflictId} (${c.kind === 'CROSS_SILO' ? 'Cross-Silo' : 'Paraconsistent'})`,
      sub: `Domain: ${c.domain} · [${c.positiveNodeIds.join(',')} ↔ ${c.negativeNodeIds.join(',')}]`,
      stroke: '#EF4444',
      fill: '#231115',
      badge: 'CONFLICT',
    });
  });

  interface Edge {
    from: string;
    to: string;
    kind: 'fact' | 'chain' | 'conflict-pos' | 'conflict-neg';
  }
  const edges: Edge[] = [];

  const mapFactAnchor = (n: GenericProvenanceNode): string => {
    if (n.silo === 'bazi') return 'IR-BAZI';
    if (n.silo === 'liuyao') return 'IR-LIUYAO';
    if (n.silo === 'toan-thu') return 'IR-TOANTHU';
    if (n.silo === 'nam-phai') return 'IR-NAMPHAI';
    return 'IR-STEM';
  };

  for (const n of stratum1) {
    const anchor = placed.has(mapFactAnchor(n)) ? mapFactAnchor(n) : (chartAnchorFacts[0]?.id ?? '');
    if (anchor && placed.has(anchor)) {
      edges.push({ from: anchor, to: n.nodeId, kind: 'fact' });
    }
  }

  for (const n of stratum2) {
    const deps = extractNodeDependencies(n).filter((d) => placed.has(d));
    if (deps.length > 0) {
      for (const d of deps) {
        edges.push({ from: d, to: n.nodeId, kind: 'chain' });
      }
    } else {
      const anchor = mapFactAnchor(n);
      if (placed.has(anchor)) {
        edges.push({ from: anchor, to: n.nodeId, kind: 'fact' });
      }
    }
  }

  for (const c of conflicts) {
    for (const posId of c.positiveNodeIds) {
      if (placed.has(posId)) {
        edges.push({ from: posId, to: c.conflictId, kind: 'conflict-pos' });
      }
    }
    for (const negId of c.negativeNodeIds) {
      if (placed.has(negId)) {
        edges.push({ from: negId, to: c.conflictId, kind: 'conflict-neg' });
      }
    }
  }

  // Compute highlighted connected component if a node is selected
  const activeIds = new Set<string>();
  if (selectedNodeId && placed.has(selectedNodeId)) {
    activeIds.add(selectedNodeId);
    // Walk backward & forward
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        if (activeIds.has(e.to) && !activeIds.has(e.from)) {
          activeIds.add(e.from);
          changed = true;
        }
        if (activeIds.has(e.from) && !activeIds.has(e.to)) {
          activeIds.add(e.to);
          changed = true;
        }
      }
    }
  }

  const edgeSvg = edges
    .map((e) => {
      const src = placed.get(e.from);
      const dst = placed.get(e.to);
      if (!src || !dst) return '';
      const x1 = src.x + boxW;
      const y1 = src.y + boxH / 2;
      const x2 = dst.x;
      const y2 = dst.y + boxH / 2;
      const cx1 = x1 + (x2 - x1) * 0.48;
      const cx2 = x1 + (x2 - x1) * 0.52;

      const isHighlighted =
        activeIds.size === 0 || (activeIds.has(e.from) && activeIds.has(e.to));
      const opacity = activeIds.size === 0 ? 0.72 : isHighlighted ? 1.0 : 0.14;

      let color = '#06B6D4';
      let dash = '';
      let width = isHighlighted && activeIds.size > 0 ? 2.4 : 1.5;
      if (e.kind === 'chain') {
        color = '#10B981';
      } else if (e.kind === 'conflict-pos') {
        color = '#D4AF37';
        dash = 'stroke-dasharray="5 3"';
        width = 2.2;
      } else if (e.kind === 'conflict-neg') {
        color = '#EF4444';
        dash = 'stroke-dasharray="5 3"';
        width = 2.2;
      }

      return `<path d="M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}" ${dash} />`;
    })
    .join('\n');

  const boxesSvg = [...placed.values()]
    .map((b) => {
      const isSelected = b.id === selectedNodeId;
      const isDimmed = activeIds.size > 0 && !activeIds.has(b.id);
      const opacity = isDimmed ? 0.25 : 1;
      const strokeW = isSelected ? 2.6 : 1.3;
      return `
        <g class="dag-node" data-node-id="${escapeHtml(b.id)}" opacity="${opacity}" transform="translate(${b.x}, ${b.y})">
          <rect width="${boxW}" height="${boxH}" rx="7" fill="${b.fill}" stroke="${b.stroke}" stroke-width="${strokeW}" />
          <rect x="${boxW - 58}" y="5" width="52" height="14" rx="4" fill="rgba(255,255,255,0.06)" />
          <text x="${boxW - 32}" y="15" text-anchor="middle" fill="${b.stroke}" font-family="'JetBrains Mono', monospace" font-size="8.5" font-weight="700">${escapeHtml(b.badge)}</text>
          <text x="9" y="16" fill="#F8FAFC" font-family="'JetBrains Mono', monospace" font-size="10.5" font-weight="700">${escapeHtml(truncate(b.title, 24))}</text>
          <text x="9" y="31" fill="#94A3B8" font-family="'Be Vietnam Pro', sans-serif" font-size="10">${escapeHtml(truncate(b.sub, 31))}</text>
        </g>
      `;
    })
    .join('\n');

  return `
    <svg class="dag-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Stratified Proof-DAG">
      <text x="${colX.s0}" y="24" fill="#06B6D4" font-family="'JetBrains Mono', monospace" font-size="10.5" font-weight="700">STRATUM 0 · CHART IR FACTS</text>
      <text x="${colX.s1}" y="24" fill="#10B981" font-family="'JetBrains Mono', monospace" font-size="10.5" font-weight="700">STRATUM 1 · ATOMIC DERIVATIONS</text>
      <text x="${colX.s2}" y="24" fill="#D4AF37" font-family="'JetBrains Mono', monospace" font-size="10.5" font-weight="700">STRATUM 2+ &amp; PARACONSISTENT CONFLICTS</text>
      <line x1="16" y1="34" x2="${svgWidth - 16}" y2="34" stroke="#1E293B" stroke-width="1" />
      ${edgeSvg}
      ${boxesSvg}
    </svg>
  `;
}
