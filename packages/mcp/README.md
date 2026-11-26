# `@sovana/mcp`

Zero-dependency **Model Context Protocol (MCP)** stdio server for the [SOVANA](../../README.md) deterministic astronomical ephemeris (`NASA JPL DE440s`), bi-temporal Vietnam GIS (`63 ↔ 34`), Zi Wei Dou Shu (*Nam Phái* 109 stars & *Toàn Thư*), Bazi (*Cùng Thông Bảo Giám*), 64-hexagram I-Ching, and 2-chart Hop Ban engine.

## Why use `@sovana/mcp`?

LLMs routinely hallucinate lunar dates, solar terms, Can-Chi pillars, pre-1975 Vietnamese timezones, and 12-palace star placements. `@sovana/mcp` gives any MCP-compatible host (Claude Code, Claude Desktop, Antigravity, Gemini CLI, OpenAI Codex, OpenCode, Cursor, Windsurf, VS Code) **bit-exact NASA JPL `DE440s` calculations** over newline-delimited JSON-RPC 2.0 (`2025-03-26` & `2024-11-05`) with **zero third-party runtime dependencies** and bundled binary ephemeris data.

## Quickstart (`npx` — Zero Setup)

```bash
npx -y @sovana/mcp --version
```

### Standard MCP Client Configuration (Claude Desktop / Cursor / Windsurf / Antigravity)

```json
{
  "mcpServers": {
    "sovana": {
      "command": "npx",
      "args": ["-y", "@sovana/mcp"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add sovana -- npx -y @sovana/mcp
```

### OpenAI Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.sovana]
command = "npx"
args = ["-y", "@sovana/mcp"]
```

### OpenCode (`opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sovana": {
      "type": "local",
      "command": ["npx", "-y", "@sovana/mcp"],
      "enabled": true
    }
  }
}
```

### Local Development (From Source)

```bash
git clone https://github.com/nguyenthanhthe/sovana.git
cd sovana
pnpm install && pnpm build
node packages/mcp/dist/cli.js --version
```

## Tools (6 Deterministic Tools)

1. `resolve_vietnam_location` — Resolve any province, district, historical alias (`Sài Gòn`, `Gia Định`, `Hà Tây`), or WGS-84 coordinate with bidirectional `63 ↔ 34` province mapping (`Nghị quyết 202/2025/QH15`).
2. `convert_vietnam_calendar` — Bidirectional solar ↔ lunar (`1900–2100`), pre-1975 South/North timezone, Meeus True Solar Time, 24 Solar Terms, and VN `UTC+7` (`121-CP`) vs CN `UTC+8` divergence flag.
3. `compile_ziwei_chart` — Compile `nam-phai` (109 stars), `toan-thu`, or `both` side-by-side with `empiricalForks`, structured classical patterns, multi-layer Tứ Hóa, and `chartSha256`.
4. `compile_bazi_chart` — Compile Four Pillars, hidden stems, Ten Gods, quantitative Day Master strength (`bps`), 10-year Đại Vận, and *Cùng Thông Bảo Giám* Điều Hậu.
5. `cast_iching_hexagram` — Cast 64-hexagram Chu Dịch via `mai-hoa` (timestamp) or `manual-lines` (6 coin values `[6|7|8|9]`).
6. `compare_charts_hopban` — Compare two charts across Marriage (`HON_NHAN`) and Business Partnership (`HOP_TAC`) with 5-pillar scoring and cross-chart Phi Hóa flights.

## License

MIT — see [LICENSE](../../LICENSE).
