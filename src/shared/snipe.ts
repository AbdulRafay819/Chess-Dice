/**
 * Deterministic snipe resolution. This is the single source of truth: the
 * serverless function runs it with a secret seed, and the client runs the same
 * function with no seed to draw its aim preview. Because the maths is plain and
 * identical everywhere, both players always see the same shot.
 *
 * Model
 * - Direction is locked to the nearest of the shooter's own movement lines.
 * - Power maps to a slide distance through friction: d = v² / (2μg), capped at
 *   six squares. v = V_MAX · power, μg = 3.0, so a full pull travels six
 *   squares and half power travels 1.5.
 * - Aim error (angle away from the locked line) sets accuracy. Accuracy plus a
 *   seeded wobble decides whether the line stays true; a veered shot slides
 *   past everything and hits nothing.
 * - Kings are only eliminable by a king; any other shooter is stopped by one.
 */

import { indexOf, onBoard, frToSquare, squareToFR, type Position } from './board';
import type { Piece, SnipeResult, Square } from './types';

export const V_MAX = 6;
export const MU = 0.306;
export const GRAVITY = 9.81;
export const MAX_SNIPE_SQUARES = 6;
export const KNIGHT_MIN_POWER = 0.28;
const AIM_TOLERANCE = 0.7; // radians of error that zeroes out accuracy

export interface SnipeDirection {
  df: number;
  dr: number;
  label: string;
}

const ORTHO: SnipeDirection[] = [
  { df: 1, dr: 0, label: 'file' },
  { df: -1, dr: 0, label: 'file' },
  { df: 0, dr: 1, label: 'rank' },
  { df: 0, dr: -1, label: 'rank' },
];

const DIAGONAL: SnipeDirection[] = [
  { df: 1, dr: 1, label: 'diagonal' },
  { df: 1, dr: -1, label: 'diagonal' },
  { df: -1, dr: 1, label: 'diagonal' },
  { df: -1, dr: -1, label: 'diagonal' },
];

const KNIGHT: SnipeDirection[] = [
  { df: 1, dr: 2, label: 'L' },
  { df: 2, dr: 1, label: 'L' },
  { df: 2, dr: -1, label: 'L' },
  { df: 1, dr: -2, label: 'L' },
  { df: -1, dr: -2, label: 'L' },
  { df: -2, dr: -1, label: 'L' },
  { df: -2, dr: 1, label: 'L' },
  { df: -1, dr: 2, label: 'L' },
];

export function snipeDirections(piece: Piece): SnipeDirection[] {
  switch (piece.type) {
    case 'r':
      return ORTHO;
    case 'b':
      return DIAGONAL;
    case 'q':
    case 'k':
      return [...ORTHO, ...DIAGONAL];
    case 'n':
      return KNIGHT;
    case 'p': {
      const dir = piece.color === 'w' ? -1 : 1;
      return [
        { df: 0, dr: dir, label: 'forward' },
        { df: -1, dr: dir, label: 'diagonal' },
        { df: 1, dr: dir, label: 'diagonal' },
      ];
    }
    default:
      return [];
  }
}

export const dirAngle = (dir: SnipeDirection) => Math.atan2(dir.dr, dir.df);

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Slide distance in squares from a 0..1 power pull. */
export function slideDistance(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  const v = V_MAX * p;
  const d = (v * v) / (2 * MU * GRAVITY);
  return Math.min(MAX_SNIPE_SQUARES, d);
}

export function mulberry32(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSquare(square: Square): number {
  let h = 2166136261;
  for (let i = 0; i < square.length; i++) {
    h ^= square.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Squares the projectile crosses before it runs out of travel. */
export function collectPath(
  from: Square,
  dir: SnipeDirection,
  travel: number,
  knight: boolean,
): Square[] {
  const { f, r } = squareToFR(from);
  const out: Square[] = [];
  if (travel <= 0) return out;

  if (knight) {
    // Knights fire along their L line, so the shot lands on L targets, never
    // between them.
    for (let hop = 1; hop <= MAX_SNIPE_SQUARES; hop++) {
      const nf = f + dir.df * hop;
      const nr = r + dir.dr * hop;
      if (!onBoard(nf, nr)) break;
      if (Math.hypot(dir.df * hop, dir.dr * hop) > travel) break;
      out.push(frToSquare(nf, nr));
    }
    return out;
  }

  const len = Math.hypot(dir.df, dir.dr);
  const ux = dir.df / len;
  const uy = dir.dr / len;
  let last = from;
  const step = 0.05;
  for (let t = step; t <= travel + 1e-6; t += step) {
    const cf = Math.round(f + ux * t);
    const cr = Math.round(r + uy * t);
    if (!onBoard(cf, cr)) break;
    const square = frToSquare(cf, cr);
    if (square !== last) {
      out.push(square);
      last = square;
    }
  }
  return out;
}

export interface ResolveInput {
  pos: Position;
  from: Square;
  angle: number;
  power: number;
  shooter: Piece;
  /** null keeps the line true (aim preview); a number applies the wobble. */
  seed: number | null;
  maxSquares?: number;
}

export function resolveSnipe(input: ResolveInput): SnipeResult {
  const { pos, from, shooter } = input;
  const maxSquares = input.maxSquares ?? MAX_SNIPE_SQUARES;
  const power = Math.max(0, Math.min(1, input.power));
  const angle = wrapAngle(input.angle);
  const dirs = snipeDirections(shooter);

  let chosen = dirs[0];
  let error = Number.POSITIVE_INFINITY;
  for (const dir of dirs) {
    const e = Math.abs(wrapAngle(angle - dirAngle(dir)));
    if (e < error) {
      error = e;
      chosen = dir;
    }
  }
  const accuracy = Math.max(0, Math.min(1, 1 - error / AIM_TOLERANCE));
  const frictionDistance = Math.min(maxSquares, slideDistance(power));

  const rng = mulberry32((input.seed ?? 0x9e3779b9) ^ hashSquare(from));
  const wobble = rng() * 2 - 1;
  const spread = 0.05 + 0.42 * (1 - accuracy);
  const veered = input.seed !== null && rng() < spread * (0.35 + 0.65 * Math.abs(wobble));

  const knight = shooter.type === 'n';
  const travel = knight
    ? power >= KNIGHT_MIN_POWER
      ? Math.hypot(chosen.df, chosen.dr)
      : 0
    : frictionDistance;
  const path = collectPath(from, chosen, travel, knight);

  let hitSquare: Square | null = null;
  let hitPiece: Piece | null = null;
  let blockedBy: Square | null = null;
  let kingProtected = false;
  let travelled = travel;
  const origin = squareToFR(from);

  for (const square of path) {
    const { f, r } = squareToFR(square);
    const piece = pos.board[indexOf(f, r)];
    if (!piece) continue;
    blockedBy = square;
    travelled = knight ? travel : Math.hypot(f - origin.f, r - origin.r);
    if (piece.color === shooter.color) break;
    if (piece.type === 'k' && shooter.type !== 'k') {
      kingProtected = true;
      break;
    }
    hitSquare = square;
    hitPiece = piece;
    break;
  }

  if (veered) {
    hitSquare = null;
    hitPiece = null;
    blockedBy = null;
    kingProtected = false;
    travelled = frictionDistance;
  }
  if (knight && travel === 0) {
    hitSquare = null;
    hitPiece = null;
    blockedBy = null;
  }

  return {
    from,
    shooter,
    direction: { df: chosen.df, dr: chosen.dr },
    dirAngle: dirAngle(chosen),
    angle,
    power,
    distance: frictionDistance,
    accuracy,
    veered,
    hitSquare,
    hitPiece,
    eliminated: !!hitPiece && !veered,
    blockedBy,
    kingProtected,
    travel: travelled,
    path: veered ? travellerPath(path, travelled) : path,
  };
}

/** A veered shot drifts off its line; report the part of the path it covered. */
function travellerPath(path: Square[], distance: number): Square[] {
  const kept: Square[] = [];
  const origin = path.length ? squareToFR(path[0]) : { f: 0, r: 0 };
  for (const square of path) {
    const { f, r } = squareToFR(square);
    if (Math.hypot(f - origin.f, r - origin.r) > distance) break;
    kept.push(square);
  }
  return kept;
}
