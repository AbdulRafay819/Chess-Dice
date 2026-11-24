/**
 * The rules of Dice Chess, shared verbatim by the browser and the serverless
 * functions. The client never decides an outcome: it renders what these
 * functions return.
 *
 * Variant rules
 * - A die is rolled at the start of every turn. Pieces keep their traditional
 *   chess movement: rooks, bishops and queens slide any distance along their
 *   own lines, kings step one square, knights jump their L, pawns advance one
 *   (or two from their start square) and capture diagonally.
 * - The roll decides how many of a selected piece's legal destinations are
 *   offered. A 1 offers one square, a 4 offers four, and so on; a piece with
 *   fewer legal moves than the roll simply shows all of them.
 * - The offer is deterministic for the roll and the piece, so re-selecting the
 *   same piece shows the same squares until the turn is made.
 * - Moving onto the enemy king is not allowed; kings fall to checkmate or to a
 *   king's snipe.
 * - A 6 gives a choice: the six-square move offer, or a snipe.
 * - A snipe ends your turn whether it hits or misses; the shooter stays put.
 * - Only a king can eliminate a king with a snipe. For any other shooter an
 *   enemy king stops the projectile.
 * - Checkmate, elimination of every enemy piece, or a sniped king ends the
 *   game. Stalemate is a draw.
 */

import type {
  Color,
  GameState,
  LastAction,
  Move,
  Piece,
  PieceType,
  PublicGameState,
  SnipeResult,
  Square,
} from './types.js';
import { other } from './types.js';
import {
  attackers,
  findKing,
  frToSquare,
  inCheck,
  indexOf,
  INITIAL_FEN,
  onBoard,
  parseFen,
  pieceAt,
  simulateMove,
  squareToFR,
  toFen,
  type Board,
  type Position,
} from './board.js';
import { dirAngle, mulberry32, resolveSnipe, snipeDirections } from './snipe.js';

export const MAX_ROLL = 6;
export const SNIPE_SQUARES = 6;

export class RulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesError';
  }
}

export function initialState(): GameState {
  return {
    fen: INITIAL_FEN,
    turn: 'w',
    die: null,
    phase: 'roll',
    status: 'playing',
    winner: null,
    endReason: null,
    lastAction: null,
    seed: 1,
    moveKey: 1,
    version: 0,
  };
}

function hash32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Derive the public, per-roll key the offer shuffle uses. */
export function moveKeyFromSeed(seed: number): number {
  return hash32((seed >>> 0) ^ 0x51ed270b);
}

/** Every destination the piece could reach with its normal chess movement. */
export function candidateMoves(pos: Position, from: Square): Move[] {
  const piece = pieceAt(pos, from);
  if (!piece) return [];
  const { f, r } = squareToFR(from);
  const out: Move[] = [];
  const push = (tf: number, tr: number, promotion: PieceType | null = null) => {
    if (!onBoard(tf, tr)) return false;
    const target = pos.board[indexOf(tf, tr)];
    if (target && target.color === piece.color) return false;
    if (target && target.type === 'k') return false; // kings are not captured by moves
    out.push({
      from,
      to: `${'abcdefgh'[tf]}${'87654321'[tr]}`,
      piece: piece.type,
      color: piece.color,
      capture: target ? target.type : null,
      promotion,
    });
    return !target;
  };

  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? -1 : 1;
    const startRank = piece.color === 'w' ? 6 : 1;
    const promotionRank = piece.color === 'w' ? 0 : 7;
    const one = r + dir;
    if (onBoard(f, one) && !pos.board[indexOf(f, one)]) {
      push(f, one, one === promotionRank ? 'q' : null);
      const two = r + dir * 2;
      if (r === startRank && !pos.board[indexOf(f, two)]) push(f, two);
    }
    for (const df of [-1, 1]) {
      const tf = f + df;
      const tr = r + dir;
      if (!onBoard(tf, tr)) continue;
      const target = pos.board[indexOf(tf, tr)];
      if (target && target.color !== piece.color && target.type !== 'k') {
        push(tf, tr, tr === promotionRank ? 'q' : null);
      }
    }
  } else if (piece.type === 'n') {
    for (const [df, dr] of [
      [1, 2],
      [2, 1],
      [2, -1],
      [1, -2],
      [-1, -2],
      [-2, -1],
      [-2, 1],
      [-1, 2],
    ]) {
      push(f + df, r + dr);
    }
  } else if (piece.type === 'k') {
    for (const [df, dr] of [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ]) {
      push(f + df, r + dr);
    }
  } else {
    const lines: number[][] = [];
    if (piece.type === 'r' || piece.type === 'q') {
      lines.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }
    if (piece.type === 'b' || piece.type === 'q') {
      lines.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }
    for (const [df, dr] of lines) {
      for (let step = 1; step < 8; step++) {
        const tf = f + df * step;
        const tr = r + dr * step;
        if (!onBoard(tf, tr)) break;
        const target = pos.board[indexOf(tf, tr)];
        if (!target) {
          push(tf, tr);
          continue;
        }
        if (target.color !== piece.color && target.type !== 'k') push(tf, tr);
        break;
      }
    }
  }

  const legal: Move[] = [];
  for (const move of out) {
    if (simulateMove(pos, from, move.to, move.promotion)) legal.push(move);
  }
  return legal;
}

/** All legal moves for a piece, regardless of the roll. */
export function movesFor(state: GameState, from: Square): Move[] {
  const pos = parseFen(state.fen);
  const piece = pieceAt(pos, from);
  if (!piece || piece.color !== state.turn || state.status !== 'playing') return [];
  return candidateMoves(pos, from);
}

/**
 * The subset of legal moves the die shows for this piece. Deterministic for
 * (moveKey, origin), so the same piece keeps the same offer for the whole turn.
 */
export function offeredMoves(state: GameState, from: Square): Move[] {
  const all = movesFor(state, from);
  if (!all.length || state.phase === 'roll') return [];
  const die = Math.max(1, Math.min(state.die ?? 1, MAX_ROLL));
  if (all.length <= die) return all;

  const { f, r } = squareToFR(from);
  const random = mulberry32(hash32(state.moveKey ^ ((r * 8 + f + 1) * 0x9e3779b1)));
  const pool = all.slice();
  for (let i = 0; i < die; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, die);
}

export function allMoves(pos: Position): Move[] {
  const out: Move[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = pos.board[indexOf(f, r)];
      if (!piece || piece.color !== pos.turn) continue;
      out.push(...candidateMoves(pos, `${'abcdefgh'[f]}${'87654321'[r]}`));
    }
  }
  return out;
}

export function pieceCount(board: Board, color: Color): number {
  return board.reduce((n, p) => n + (p && p.color === color ? 1 : 0), 0);
}

export interface EndResult {
  finished: boolean;
  winner: Color | null;
  reason: 'checkmate' | 'elimination' | 'king-snipe' | 'stalemate' | null;
}

/** Terminal-state check, independent of the current die so both players see
 *  the same result regardless of what is rolled next. */
export function evaluateEnd(pos: Position): EndResult {
  // A king can only leave the board by being sniped (moves cannot capture one),
  // so a missing king is always a king-snipe — and takes precedence over an
  // empty army, which is what a wiped-out side looks like afterwards.
  if (!findKing(pos.board, 'w')) return { finished: true, winner: 'b', reason: 'king-snipe' };
  if (!findKing(pos.board, 'b')) return { finished: true, winner: 'w', reason: 'king-snipe' };

  const white = pieceCount(pos.board, 'w');
  const black = pieceCount(pos.board, 'b');
  if (white === 0) return { finished: true, winner: 'b', reason: 'elimination' };
  if (black === 0) return { finished: true, winner: 'w', reason: 'elimination' };

  const checked = inCheck(pos, pos.turn);
  const hasMove = allMoves(pos).length > 0;
  if (!hasMove) {
    if (checked) return { finished: true, winner: other(pos.turn), reason: 'checkmate' };
    return { finished: true, winner: null, reason: 'stalemate' };
  }
  return { finished: false, winner: null, reason: null };
}

function withEnd(state: GameState, pos: Position, lastAction: LastAction): GameState {
  const end = evaluateEnd(pos);
  return {
    ...state,
    fen: toFen(pos),
    turn: pos.turn,
    lastAction,
    winner: end.winner,
    endReason: end.reason,
    status: end.finished ? 'finished' : 'playing',
    phase: end.finished ? 'over' : 'roll',
    die: null,
  };
}

export function applyRoll(state: GameState, value: number, seed: number): GameState {
  if (state.status !== 'playing') throw new RulesError('Game is finished.');
  if (state.phase !== 'roll') throw new RulesError('You already rolled this turn.');
  if (value < 1 || value > MAX_ROLL) throw new RulesError('Invalid die value.');
  return {
    ...state,
    die: value,
    phase: value === MAX_ROLL ? 'choice' : 'move',
    seed,
    moveKey: moveKeyFromSeed(seed),
    lastAction: { type: 'roll', value },
  };
}

export function applyChoice(state: GameState, choice: 'move' | 'snipe'): GameState {
  if (state.phase !== 'choice' || state.die !== MAX_ROLL) {
    throw new RulesError('Sniping is only available on a six.');
  }
  // In check, a snipe is only worth the turn when it can remove the checker;
  // otherwise the only legal plan is a move that blocks, captures or steps away.
  if (choice === 'snipe' && sideInCheck(state) && !hasCheckShot(state)) {
    throw new RulesError(
      'Your king is in check and no shot reaches the checking piece — move to block the check.',
    );
  }
  return {
    ...state,
    phase: choice === 'move' ? 'move' : 'snipe',
    lastAction: { type: 'choice', choice },
  };
}

export function applyMove(state: GameState, from: Square, to: Square): GameState {
  if (state.status !== 'playing') throw new RulesError('Game is finished.');
  if (state.phase !== 'move') throw new RulesError('Roll the die and pick a normal move first.');
  const pos = parseFen(state.fen);
  const piece = pieceAt(pos, from);
  if (!piece || piece.color !== state.turn) throw new RulesError('That is not your piece.');
  const move = offeredMoves(state, from).find((m) => m.to === to);
  if (!move) throw new RulesError('That square was not offered by your roll.');
  const { f: ff, r: fr } = squareToFR(from);
  const { f: tf, r: tr } = squareToFR(to);
  const target = pos.board[indexOf(tf, tr)];
  pos.board[indexOf(ff, fr)] = null;
  pos.board[indexOf(tf, tr)] = {
    type: move.promotion ?? piece.type,
    color: piece.color,
  };
  pos.turn = other(piece.color);
  return withEnd(state, pos, {
    type: 'move',
    from,
    to,
    piece: piece.type,
    capture: target ? target.type : null,
  });
}

export interface SnipeOutcome {
  state: GameState;
  result: SnipeResult;
}

export function applySnipe(
  state: GameState,
  from: Square,
  angle: number,
  power: number,
  seed: number,
): SnipeOutcome {
  if (state.status !== 'playing') throw new RulesError('Game is finished.');
  if (state.phase !== 'snipe' || state.die !== MAX_ROLL) {
    throw new RulesError('Sniping requires a chosen six.');
  }
  const pos = parseFen(state.fen);
  const piece = pieceAt(pos, from);
  if (!piece || piece.color !== state.turn) throw new RulesError('That is not your piece.');
  if (!snipeTargetsChecker(state, from, angle, power)) {
    throw new RulesError('Your king is in check: snipe the checking piece, or move to block.');
  }

  const result = resolveSnipe({
    pos,
    from,
    angle,
    power,
    shooter: piece,
    seed,
    maxSquares: SNIPE_SQUARES,
  });

  const next = { board: pos.board.slice(), turn: pos.turn };
  if (result.eliminated && result.hitSquare) {
    const { f, r } = squareToFR(result.hitSquare);
    next.board[indexOf(f, r)] = null;
  }
  next.turn = other(piece.color);
  return {
    state: withEnd(state, next, { type: 'snipe', result }),
    result,
  };
}

/** Directions a piece may snipe along, used by both the aim UI and the rules. */
export function snipeLines(piece: Piece) {
  return snipeDirections(piece);
}

/** Pure preview used to draw the aim line. Never includes server wobble. */
export function previewSnipe(state: GameState, from: Square, angle: number, power: number) {
  const pos = parseFen(state.fen);
  const piece = pieceAt(pos, from);
  if (!piece) return null;
  return resolveSnipe({
    pos,
    from,
    angle,
    power,
    shooter: piece,
    seed: null,
    maxSquares: SNIPE_SQUARES,
  });
}

/** Squares of the enemy pieces giving check to the side to move. */
export function checkingPieces(state: GameState): Square[] {
  const pos = parseFen(state.fen);
  const king = findKing(pos.board, state.turn);
  if (!king) return [];
  return attackers(pos.board, king, other(state.turn));
}

/** Is the side to move currently in check? */
export function sideInCheck(state: GameState): boolean {
  return inCheck(parseFen(state.fen), state.turn);
}

/**
 * A shot in check must take a piece that is actually checking the king. The
 * aimed line is judged before the seeded wobble, so a perfect aim can still
 * drift wide — the rule constrains intent, not luck.
 */
export function snipeTargetsChecker(
  state: GameState,
  from: Square,
  angle: number,
  power: number,
): boolean {
  if (!sideInCheck(state)) return true;
  const checkers = checkingPieces(state);
  if (!checkers.length) return false;
  const preview = previewSnipe(state, from, angle, power);
  return Boolean(preview?.eliminated && preview.hitSquare && checkers.includes(preview.hitSquare));
}

/** Can any of the mover's pieces reach a checking piece with a snipe? */
export function hasCheckShot(state: GameState): boolean {
  if (!sideInCheck(state)) return true;
  const checkers = checkingPieces(state);
  if (!checkers.length) return false;
  const pos = parseFen(state.fen);
  for (let i = 0; i < 64; i++) {
    const piece = pos.board[i];
    if (!piece || piece.color !== state.turn) continue;
    const from = frToSquare(i % 8, Math.floor(i / 8));
    for (const dir of snipeDirections(piece)) {
      const preview = previewSnipe(state, from, dirAngle(dir), 1);
      if (preview?.eliminated && preview.hitSquare && checkers.includes(preview.hitSquare)) {
        return true;
      }
    }
  }
  return false;
}

/** Places the die back in the cup when a new game starts. */
export function isMyTurn(state: PublicGameState, color: Color | null): boolean {
  return !!color && state.turn === color && state.status === 'playing';
}
