/**
 * Computer opponent.
 *
 * Pure functions over the shared rules, so the AI can only ever choose from the
 * squares the die actually offered — it plays the same game a human does. The
 * decision layer is a one-ply material/tempo search with a shallow mate probe;
 * difficulty changes how much noise it tolerates, not what the rules allow.
 */

import {
  inCheck,
  isAttacked,
  parseFen,
  pieceAt,
  simulateMove,
  squareToFR,
  type Position,
} from './board';
import { allMoves, checkingPieces, offeredMoves, previewSnipe, sideInCheck } from './rules';
import { dirAngle, snipeDirections } from './snipe';
import type { Color, GameState, Move, PieceType, Square } from './types';
import { other } from './types';

export type Skill = 'easy' | 'normal' | 'sharp';

export const SKILLS: { id: Skill; label: string; blurb: string }[] = [
  { id: 'easy', label: 'Casual', blurb: 'Loose play, shaky aim' },
  { id: 'normal', label: 'Club', blurb: 'Takes material, aims straight' },
  { id: 'sharp', label: 'Sharp', blurb: 'Punishes every slip' },
];

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };

/** Wobble added to a shot angle, in radians: lower skill, looser shot. */
const AIM_JITTER: Record<Skill, number> = { easy: 0.24, normal: 0.09, sharp: 0.015 };
/** Material worth sniping instead of moving. */
const SNIPE_THRESHOLD: Record<Skill, number> = { easy: 4.2, normal: 2.6, sharp: 1.5 };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export interface ScoredMove {
  move: Move;
  score: number;
}

export interface AiShot {
  from: Square;
  angle: number;
  power: number;
  value: number;
}

export interface AiChoice {
  kind: 'move' | 'snipe';
  move?: Move;
  shot?: AiShot;
}

function materialScore(pos: Position, color: Color, move: Move): number {
  const piece = pieceAt(pos, move.from);
  if (!piece) return 0;
  let score = 0;

  if (move.capture) score += VALUE[move.capture] * 1.1;
  if (move.promotion) score += VALUE[move.promotion] - VALUE.p;

  // Central squares matter more for the slow pieces.
  const { f, r } = squareToFR(move.to);
  if (piece.type === 'p' || piece.type === 'n') {
    const centre = 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5));
    score += centre * 0.09;
  }
  if (piece.type === 'p') {
    // Push pawns toward the far rank.
    const progress = piece.color === 'w' ? 7 - r : r;
    score += progress * 0.05;
  }

  const next = simulateMove(pos, move.from, move.to, move.promotion);
  if (!next) return -Infinity;

  const opp = other(piece.color);
  // A destination the opponent attacks is only worth it when defended.
  if (isAttacked(next.board, move.to, opp)) {
    const defended = isAttacked(next.board, move.to, piece.color);
    score -= VALUE[piece.type] * (defended ? 0.2 : 0.55);
  }
  // Hanging enemy pieces are free material next turn.
  const oppPos: Position = { board: next.board, turn: opp };
  if (inCheck(oppPos, opp)) score += 0.5;

  // Escaping a square that is attacked right now is worth something.
  if (isAttacked(pos.board, move.from, opp)) score += VALUE[piece.type] * 0.25;

  return score;
}

/** One move, scored for `state.turn`, using only what the die offered. */
export function rankMoves(state: GameState): ScoredMove[] {
  const pos = parseFen(state.fen);
  const out: ScoredMove[] = [];
  for (let i = 0; i < 64; i++) {
    const piece = pos.board[i];
    if (!piece || piece.color !== state.turn) continue;
    const square = `${'abcdefgh'[i % 8]}${'87654321'[Math.floor(i / 8)]}`;
    for (const move of offeredMoves(state, square)) {
      const score = materialScore(pos, state.turn, move);
      if (score !== -Infinity) out.push({ move, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Does this move end the game immediately? Checked only for the top few. */
function isMate(state: GameState, move: Move): boolean {
  const pos = parseFen(state.fen);
  const next = simulateMove(pos, move.from, move.to, move.promotion);
  if (!next) return false;
  const opp = other(state.turn);
  const oppPos: Position = { board: next.board, turn: opp };
  return inCheck(oppPos, opp) && allMoves(oppPos).length === 0;
}

/**
 * Best shot available from the current snipe phase, aimed dead on its line and
 * pulled to the distance of the first enemy piece on it.
 */
export function rankShots(state: GameState, skill: Skill): AiShot[] {
  const pos = parseFen(state.fen);
  const shots: AiShot[] = [];
  const jitter = AIM_JITTER[skill];
  // In check only a shot that takes the checker is legal, so it is the only
  // shot worth ranking — anything else would be rejected by the rules.
  const checkers = sideInCheck(state) ? checkingPieces(state) : [];

  for (let i = 0; i < 64; i++) {
    const piece = pos.board[i];
    if (!piece || piece.color !== state.turn) continue;
    const from = `${'abcdefgh'[i % 8]}${'87654321'[Math.floor(i / 8)]}`;
    for (const dir of snipeDirections(piece)) {
      const preview = previewSnipe(state, from, dirAngle(dir), 1);
      if (!preview || !preview.hitPiece || !preview.hitSquare) continue;
      const target = preview.hitPiece;
      if (target.color === piece.color) continue;
      if (target.type === 'k') {
        // Only a king can take a king; anything else is a wasted shot.
        if (piece.type !== 'k') continue;
      }
      if (checkers.length && !checkers.includes(preview.hitSquare)) continue;
      const steps = Math.max(1, preview.path.indexOf(preview.hitSquare) + 1);
      const distance = Math.hypot(dir.df, dir.dr) * steps;
      const worth = target.type === 'k' ? 400 : VALUE[target.type];
      shots.push({
        from,
        angle: dirAngle(dir) + (Math.random() * 2 - 1) * jitter,
        power: clamp(Math.sqrt((distance + 0.5) / 6), 0.3, 1),
        value: worth,
      });
    }
  }
  shots.sort((a, b) => b.value - a.value);
  return shots;
}

/**
 * Decide and return the turn's action. `state` must be in the move or snipe
 * phase; the roll itself is made by the caller so it can animate it.
 */
export function decideAction(state: GameState, skill: Skill): AiChoice {
  const shots = state.phase === 'snipe' ? rankShots(state, skill) : [];
  const shot = shots[0];
  const snipeWanted = shot !== undefined && shot.value >= SNIPE_THRESHOLD[skill];

  if (snipeWanted) return { kind: 'snipe', shot };
  if (state.phase !== 'move') {
    // A six that offered a snipe but no worthwhile target: play a move instead.
    return { kind: 'move' };
  }

  const ranked = rankMoves(state);
  if (!ranked.length) return { kind: 'move' };

  // Mate first, but only probe the few moves that already look best.
  for (const entry of ranked.slice(0, 3)) {
    if (isMate(state, entry.move)) return { kind: 'move', move: entry.move };
  }

  const pool =
    skill === 'easy' ? ranked.slice(0, 6) : skill === 'normal' ? ranked.slice(0, 3) : ranked.slice(0, 1);
  const bias = skill === 'easy' ? 2.2 : skill === 'normal' ? 2.8 : 1;
  const index = Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), bias) * pool.length));
  return { kind: 'move', move: pool[index].move };
}

/** Whether the position offers the computer any shot at all. */
export function hasShot(state: GameState, skill: Skill): boolean {
  const shot = rankShots(state, skill)[0];
  return Boolean(shot && shot.value >= SNIPE_THRESHOLD[skill]);
}
