/**
 * Board geometry and FEN round-tripping.
 *
 * Positions are parsed with chess.js (so FEN handling matches the reference
 * library) and then mutated on a plain 64-square array, because this variant
 * allows moves that chess.js' generator does not represent (a rook sliding up
 * to six squares, a king firing along a line).
 */

import { Chess } from 'chess.js';
import type { Color, Piece, PieceType, Square } from './types';

export const FILES = 'abcdefgh';
export const RANKS = '87654321';

/** r = 0 is rank 8, f = 0 is file a. */
export type Board = (Piece | null)[];

export interface Position {
  board: Board;
  turn: Color;
}

export const indexOf = (f: number, r: number) => r * 8 + f;
export const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;

export function squareToFR(square: Square): { f: number; r: number } {
  const f = FILES.indexOf(square[0]);
  const r = RANKS.indexOf(square[1]);
  return { f, r };
}

export function frToSquare(f: number, r: number): Square {
  return FILES[f] + RANKS[r];
}

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';

export function parseFen(fen: string): Position {
  const chess = new Chess(fen);
  const rows = chess.board();
  const board: Board = new Array(64).fill(null);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = rows[r][f];
      if (!cell) continue;
      board[indexOf(f, r)] = { type: cell.type as PieceType, color: cell.color as Color };
    }
  }
  return { board, turn: chess.turn() as Color };
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = pos.board[indexOf(f, r)];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      const letter = piece.type;
      row += piece.color === 'w' ? letter.toUpperCase() : letter;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  // Castling and en-passant rights are not used by this variant.
  return `${rows.join('/')} ${pos.turn} - - 0 1`;
}

export function pieceAt(pos: Position, square: Square): Piece | null {
  const { f, r } = squareToFR(square);
  return pos.board[indexOf(f, r)] ?? null;
}

export function findKing(board: Board, color: Color): Square | null {
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece && piece.type === 'k' && piece.color === color) {
      return frToSquare(i % 8, Math.floor(i / 8));
    }
  }
  return null;
}

const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_STEPS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const ROOK_LINES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const BISHOP_LINES = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Is `square` attacked by any piece of `by`? Written locally so extended
 *  movement can be validated without relying on chess.js internals. */
export function isAttacked(board: Board, square: Square, by: Color): boolean {
  const { f, r } = squareToFR(square);

  const pawnRow = by === 'w' ? r + 1 : r - 1;
  const pawn = board[indexOf(f - 1, pawnRow)];
  if (pawn && pawn.type === 'p' && pawn.color === by && onBoard(f - 1, pawnRow)) return true;
  const pawn2 = board[indexOf(f + 1, pawnRow)];
  if (pawn2 && pawn2.type === 'p' && pawn2.color === by && onBoard(f + 1, pawnRow)) return true;

  for (const [df, dr] of KNIGHT_STEPS) {
    const nf = f + df;
    const nr = r + dr;
    if (!onBoard(nf, nr)) continue;
    const piece = board[indexOf(nf, nr)];
    if (piece && piece.color === by && piece.type === 'n') return true;
  }

  for (const [df, dr] of KING_STEPS) {
    const nf = f + df;
    const nr = r + dr;
    if (!onBoard(nf, nr)) continue;
    const piece = board[indexOf(nf, nr)];
    if (piece && piece.color === by && piece.type === 'k') return true;
  }

  const slide = (lines: number[][], types: PieceType[]) => {
    for (const [df, dr] of lines) {
      for (let step = 1; step < 8; step++) {
        const nf = f + df * step;
        const nr = r + dr * step;
        if (!onBoard(nf, nr)) break;
        const piece = board[indexOf(nf, nr)];
        if (!piece) continue;
        if (piece.color === by && types.includes(piece.type)) return true;
        break;
      }
    }
    return false;
  };

  if (slide(ROOK_LINES, ['r', 'q'])) return true;
  if (slide(BISHOP_LINES, ['b', 'q'])) return true;
  return false;
}

export function inCheck(pos: Position, color: Color): boolean {
  const king = findKing(pos.board, color);
  if (!king) return true;
  return isAttacked(pos.board, king, color === 'w' ? 'b' : 'w');
}

export function clonePosition(pos: Position): Position {
  return { board: pos.board.slice(), turn: pos.turn };
}

/** Apply a move to a cloned position, returning null when the mover's king
 *  would be left in check. */
export function simulateMove(
  pos: Position,
  from: Square,
  to: Square,
  promotion: PieceType | null = null,
): Position | null {
  const { f: ff, r: fr } = squareToFR(from);
  const { f: tf, r: tr } = squareToFR(to);
  const piece = pos.board[indexOf(ff, fr)];
  if (!piece) return null;
  const next = clonePosition(pos);
  next.board[indexOf(ff, fr)] = null;
  next.board[indexOf(tf, tr)] = promotion
    ? { type: promotion, color: piece.color }
    : { type: piece.type, color: piece.color };
  if (inCheck(next, piece.color)) return null;
  return next;
}
