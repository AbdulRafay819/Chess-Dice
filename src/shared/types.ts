/** Shared types for rules, server and client. Keep this file dependency-free. */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = string; // 'a1' .. 'h8'

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface Move {
  from: Square;
  to: Square;
  piece: PieceType;
  color: Color;
  capture: PieceType | null;
  promotion: PieceType | null;
}

/** phase 'roll' → roll → 'move' (1-5) or 'choice' (6) → 'move' | 'snipe' → back to 'roll'. */
export type Phase = 'roll' | 'choice' | 'move' | 'snipe' | 'over';

export interface SnipeRequest {
  /** Origin square. */
  from: Square;
  /** Aim angle in board space: atan2(rankDelta, fileDelta), radians. */
  angle: number;
  /** 0..1 drag power. */
  power: number;
}

export interface SnipeResult {
  from: Square;
  shooter: Piece;
  /** Locked movement line, in board steps (file, rank). */
  direction: { df: number; dr: number };
  dirAngle: number;
  angle: number;
  power: number;
  /** Slide distance from friction, in board squares (0..6). */
  distance: number;
  /** 0..1 aim precision relative to the locked line. */
  accuracy: number;
  /** Line did not stay true (server-seeded wobble). */
  veered: boolean;
  hitSquare: Square | null;
  hitPiece: Piece | null;
  eliminated: boolean;
  /** First square occupied by something the shot could not pass. */
  blockedBy: Square | null;
  /** A non-king shooter tried to hit a king; the king stopped the shot. */
  kingProtected: boolean;
  /** Where the projectile came to rest, in board squares from the origin. */
  travel: number;
  /** Squares the projectile crossed, in order (for the laser and impact FX). */
  path: Square[];
}

export type LastAction =
  | { type: 'roll'; value: number }
  | { type: 'choice'; choice: 'move' | 'snipe' }
  | { type: 'move'; from: Square; to: Square; piece: PieceType; capture: PieceType | null }
  | { type: 'snipe'; result: SnipeResult }
  | { type: 'end'; reason: string }
  | null;

export interface GameState {
  fen: string;
  turn: Color;
  die: number | null;
  phase: Phase;
  status: 'waiting' | 'playing' | 'finished';
  winner: Color | null;
  endReason: string | null;
  lastAction: LastAction;
  /** Server-only RNG seed; never sent to clients before the shot resolves. */
  seed: number;
  /** Public, hashed roll key. Both sides derive the same offered moves from it
   *  without being able to work back to `seed` (the shot wobble). */
  moveKey: number;
  version: number;
}

export interface PublicGameState extends Omit<GameState, 'seed'> {}

export function publicState(state: GameState): PublicGameState {
  const { seed: _seed, ...rest } = state;
  return rest;
}

export function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export const PIECE_NAME: Record<PieceType, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};
