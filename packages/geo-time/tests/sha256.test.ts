import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256BytesToHex, sha256Hex } from '../src/index.js';

function nodeSha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

describe('Pure-TS RFC 6234 SHA-256', () => {
  it('matches node:crypto across empty string, ASCII, and Vietnamese UTF-8 diacritics', () => {
    const cases = [
      '',
      'abc',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      'Vận Mệnh — Tử Vi Nam Phái · 1968 Tết Mậu Thân (Đà Nẵng → TP. Hồ Chí Minh)',
      'ấ ể ữ ậ đ Đ ơ ư ă â ê ô',
      '{"a":0,"b":1,"c":"Tiết Khí Lập Xuân"}',
    ];
    for (const s of cases) {
      expect(sha256Hex(s)).toBe(nodeSha256(s));
      expect(sha256BytesToHex(new TextEncoder().encode(s))).toBe(nodeSha256(s));
    }
  });

  it('matches node:crypto across 55/56/64/128-byte block boundaries', () => {
    for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 256]) {
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buf[i] = (i * 31 + 7) & 0xff;
      }
      expect(sha256BytesToHex(buf)).toBe(nodeSha256(buf));
      expect(sha256Hex(buf)).toBe(nodeSha256(buf));
    }
  });

  it('handles arbitrary Uint8Array views with non-zero byteOffset and sub-slice byteLength', () => {
    const backing = new Uint8Array(200);
    for (let i = 0; i < backing.length; i++) {
      backing[i] = (i * 13 + 3) & 0xff;
    }
    const slice1 = backing.subarray(17, 17 + 55);
    const slice2 = backing.subarray(19, 19 + 64);
    const slice3 = new Uint8Array(backing.buffer, 33, 0);

    expect(sha256BytesToHex(slice1)).toBe(nodeSha256(slice1));
    expect(sha256Hex(slice1)).toBe(nodeSha256(slice1));
    expect(sha256BytesToHex(slice2)).toBe(nodeSha256(slice2));
    expect(sha256BytesToHex(slice3)).toBe(nodeSha256(slice3));
  });
});
