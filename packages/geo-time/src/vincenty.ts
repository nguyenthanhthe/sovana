import { BRANCHES_VI, floorMod } from './ephemeris.js';
import type { MigrationAzimuthResult } from './types.js';

const WGS84_A = 6378137.0;
const WGS84_F = 1.0 / 298.257223563;
const WGS84_B = WGS84_A * (1.0 - WGS84_F);
const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

export function computeMigrationAzimuth(
  originLatDeg: number,
  originLonDeg: number,
  destLatDeg: number,
  destLonDeg: number,
): MigrationAzimuthResult {
  const phi1 = originLatDeg * DEG2RAD;
  const phi2 = destLatDeg * DEG2RAD;
  const L = (destLonDeg - originLonDeg) * DEG2RAD;

  if (Math.abs(phi1 - phi2) < 1e-12 && Math.abs(L) < 1e-12) {
    return {
      distanceMeters: 0,
      forwardAzimuthMilliDeg: 0,
      forwardAzimuthDeg: 0,
      palaceBranch: 0,
      palaceBranchVi: BRANCHES_VI[0]!,
      isSignificantMigration: false,
      isSectorBoundaryAmbiguous: false,
      minSectorBoundaryMilliDeg: 15_000,
    };
  }

  const U1 = Math.atan((1.0 - WGS84_F) * Math.tan(phi1));
  const U2 = Math.atan((1.0 - WGS84_F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let iter = 0;
  let sinSigma = 0.0;
  let cosSigma = 0.0;
  let sigma = 0.0;
  let sinAlpha = 0.0;
  let cos2Alpha = 0.0;
  let cos2SigmaM = 0.0;
  let converged = false;

  while (iter < 200) {
    iter++;
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0.0) {
      converged = true;
      break;
    }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1.0 - sinAlpha ** 2;
    cos2SigmaM = cos2Alpha !== 0.0 ? cosSigma - (2.0 * sinU1 * sinU2) / cos2Alpha : 0.0;
    const C = (WGS84_F / 16.0) * cos2Alpha * (4.0 + WGS84_F * (4.0 - 3.0 * cos2Alpha));
    const lambdaPrev = lambda;
    lambda =
      L +
      (1.0 - C) *
        WGS84_F *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1.0 + 2.0 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - lambdaPrev) < 1e-12) {
      converged = true;
      break;
    }
  }

  let distanceMeters: number;
  let alpha1Deg: number;

  if (converged && sinSigma > 0.0) {
    const uSq = (cos2Alpha * (WGS84_A ** 2 - WGS84_B ** 2)) / WGS84_B ** 2;
    const A = 1.0 + (uSq / 16384.0) * (4096.0 + uSq * (-768.0 + uSq * (320.0 - 175.0 * uSq)));
    const B = (uSq / 1024.0) * (256.0 + uSq * (-128.0 + uSq * (74.0 - 47.0 * uSq)));
    const deltaSigma =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4.0) *
          (cosSigma * (-1.0 + 2.0 * cos2SigmaM ** 2) -
            (B / 6.0) * cos2SigmaM * (-3.0 + 4.0 * sinSigma ** 2) * (-3.0 + 4.0 * cos2SigmaM ** 2)));
    const s = WGS84_B * A * (sigma - deltaSigma);
    const alpha1 = Math.atan2(cosU2 * Math.sin(lambda), cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda));
    distanceMeters = Math.round(s);
    alpha1Deg = alpha1 * RAD2DEG;
  } else {
    // Spherical fallback for exact/near antipodes
    const dSigma = Math.acos(Math.max(-1.0, Math.min(1.0, Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(L))));
    distanceMeters = Math.round(6371008.8 * dSigma);
    const y = Math.sin(L) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(L);
    alpha1Deg = Math.atan2(y, x) * RAD2DEG;
  }

  const forwardAzimuthMilliDeg = floorMod(Math.round(alpha1Deg * 1000.0), 360_000);
  const shifted = (forwardAzimuthMilliDeg + 15_000) % 360_000;
  const palaceBranch = Math.floor(shifted / 30_000);
  const rem = shifted % 30_000;
  const minSectorBoundaryMilliDeg = Math.min(rem, 30_000 - rem);

  return {
    distanceMeters,
    forwardAzimuthMilliDeg,
    forwardAzimuthDeg: forwardAzimuthMilliDeg / 1000.0,
    palaceBranch,
    palaceBranchVi: BRANCHES_VI[palaceBranch]!,
    isSignificantMigration: distanceMeters >= 30_000,
    isSectorBoundaryAmbiguous: minSectorBoundaryMilliDeg <= 2_000,
    minSectorBoundaryMilliDeg,
  };
}
