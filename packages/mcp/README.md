# `@sovana/mcp`

Zero-dependency **Model Context Protocol (MCP)** stdio server for the [SOVANA](../../README.md) deterministic astronomical, bi-temporal Vietnam GIS, Zi Wei Dou Shu, Bazi, I-Ching, and Hop Ban calculation engine.

## Why use `@sovana/mcp`?

LLMs routinely hallucinate lunar dates, solar terms, Can-Chi pillars, pre-1975 Vietnamese timezones, and 12-palace star placements. `@sovana/mcp` gives any MCP-compatible host (Claude Desktop, Cursor, Windsurf, Antigravity, VS Code, LangChain) **bit-exact NASA JPL `DE440s` calculations** over newline-delimited JSON-RPC 2.0 (`2025-03-26` & `2024-11-05`) with **zero third-party runtime dependencies**.

## Setup

```bash
# From repository root
pnpm install && pnpm build
node packages/mcp/dist/cli.js --version
```

### Client Configuration (`claude_desktop_config.json` / `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "sovana": {
      "command": "node",
      "args": ["/absolute/path/to/sovana/packages/mcp/dist/cli.js"]
    }
  }
}
```

## Tools

1. `resolve_vietnam_location` — Resolve any province, district, historical alias (`Sài Gòn`, `Gia Định`, `Hà Tây`), or WGS-84 coordinate with bidirectional `63 ↔ 34` province mapping (`Nghị quyết 202/2025/QH15`).
2. `convert_vietnam_calendar` — Bidirectional solar ↔ lunar (`1900–2100`), pre-1975 South/North timezone, Meeus True Solar Time, 24 Solar Terms, and VN `UTC+7` (`121-CP`) vs CN `UTC+8` divergence flag.
3. `compile_ziwei_chart` — Compile `nam-phai` (109 stars), `toan-thu`, or `both` side-by-side with `empiricalForks`, structured classical patterns, multi-layer Tứ Hóa, and `chartSha256`.
4. `compile_bazi_chart` — Compile Four Pillars, hidden stems, Ten Gods, quantitative Day Master strength, 10-year Đại Vận, and *Cùng Thông Bảo Giám* Điều Hậu.
5. `cast_iching_hexagram` — Cast 64-hexagram Chu Dịch via `mai-hoa` (timestamp) or `manual-lines` (6 coin values `[6|7|8|9]`).
6. `compare_charts_hopban` — Compare two charts across Marriage (`HON_NHAN`) and Business Partnership (`HOP_TAC`) with 5-pillar scoring and cross-chart Phi Hóa flights.

## License

MIT — see [LICENSE](../../LICENSE).
