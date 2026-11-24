import * as THREE from 'three';
import { findKing, frToSquare, inCheck, parseFen, pieceAt } from './shared/board';
import {
  applyChoice,
  applyMove,
  applyRoll,
  applySnipe,
  checkingPieces,
  hasCheckShot,
  initialState,
  offeredMoves,
  previewSnipe,
  sideInCheck,
} from './shared/rules';
import type {
  Color,
  GameState,
  Move,
  Piece,
  PublicGameState,
  SnipeResult,
  Square,
} from './shared/types';
import { PIECE_NAME } from './shared/types';
import { Aurevak } from './render/aurevak';
import { BoardView } from './render/board3d';
import { Die } from './render/die';
import { createPieceMaterials } from './render/materials';
import { loadPieceModels } from './render/models';
import { buildOutline, buildProceduralPiece } from './render/pieces';
import { Physics } from './render/physics';
import { AimGuide, ShotFX } from './render/shotfx';
import { Stage } from './render/stage';
import { LAST_ROOM_KEY, Net } from './net/client';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { decideAction, hasShot, rankShots, type Skill } from './shared/ai';

type AnyState = GameState | PublicGameState;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

const stageHost = document.querySelector<HTMLElement>('#stage')!;
const stage = new Stage(stageHost);
const board = new BoardView();
stage.add(board.group);

const pieceRoot = new THREE.Group();
stage.add(pieceRoot);

const physics = new Physics();
const die = new Die(physics);
stage.add(die.group);

// The monument that casts the die. Its core flares and the die leaves its hand.
const aurevak = new Aurevak();
stage.add(aurevak.group);

const aim = new AimGuide(board);
stage.add(aim.group);
const shotfx = new ShotFX(stage, board);

/* ------------------------------------------------------------------ *
 * Game state
 * ------------------------------------------------------------------ */

let mode: 'solo' | 'computer' | 'online' = 'solo';
let aiSkill: Skill = 'normal';
let aiRunning = false;
let aiTurnId = 0;
let solo: GameState = { ...initialState(), version: 1 };
let online: PublicGameState | null = null;
let myColor: Color | null = null;
let playersConnected = 2;
let preferredView: 'bird' | 'human' = 'human';

let selected: Square | null = null;
let legal: Move[] = [];
let aiming: { from: Square; start: THREE.Vector3; power: number; angle: number } | null = null;
let busy = false;
let snipePlaying = false;
let pendingState: AnyState | null = null;
let snipeSeen = -1;

const pieceViews = new Map<Square, THREE.Group>();
const dropTweens: { group: THREE.Group; t: number; baseY: number }[] = [];
const debris: {
  body: NonNullable<ReturnType<Physics['spawnDebris']>>;
  mesh: THREE.Group;
  until: number;
}[] = [];
let outline: THREE.Group | null = null;
let models = new Map<string, THREE.Object3D>();

const S = (): AnyState => (mode === 'solo' ? solo : online ?? solo);

function canAct(): boolean {
  const state = S();
  if (state.status !== 'playing') return false;
  if (mode === 'solo') return true;
  if (mode === 'computer') return state.turn === 'w';
  return Boolean(myColor && state.turn === myColor);
}

/* ------------------------------------------------------------------ *
 * HUD
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Settings and screens
 * ------------------------------------------------------------------ */

let shakeEnabled = true;
let reduceMotion = false;

try {
  shakeEnabled = localStorage.getItem('dicechess:shake') !== '0';
  reduceMotion =
    localStorage.getItem('dicechess:motion') === '1' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
} catch {
  /* private mode */
}
stage.reduceShake = !shakeEnabled;
stage.reduceMotion = reduceMotion;

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const hud = new Hud({
  onRoll: () => void rollDie(),
  onChoose: (choice) => choose(choice),
  onView: (view) => setView(view),
  onMenu: () => screens.show('pause'),
  onPlayAgain: () => rematch(),
  onExitToMenu: () => goToMenu(),
});

const screens = new Screens({
  onStartComputer: (skill) => startGame('computer', skill),
  onStartLocal: () => startGame('solo'),
  onOpenRooms: () => screens.push('rooms'),
  onResume: () => screens.close(),
  onNewGame: () => {
    screens.close();
    rematch();
  },
  onExitToMenu: () => goToMenu(),
  onCreateRoom: () => void createRoom(),
  onJoinRoom: (code) => void joinRoom(code),
  onCopyInvite: () => void copyInvite(),
  onToggleShake: (enabled) => {
    shakeEnabled = enabled;
    stage.reduceShake = !enabled;
    persist('dicechess:shake', enabled ? '1' : '0');
  },
  onToggleMotion: (enabled) => {
    reduceMotion = enabled;
    stage.reduceMotion = enabled;
    document.body.classList.toggle('reduce-motion', enabled);
    persist('dicechess:motion', enabled ? '1' : '0');
  },
});
screens.setSettings(shakeEnabled, reduceMotion);
document.body.classList.toggle('reduce-motion', reduceMotion);

const net = new Net();
net.onState = (next) => {
  if (mode !== 'online') return;
  myColor = net.session?.color ?? myColor;
  present(next);
};
net.onPresence = (players) => {
  playersConnected = Math.max(1, players.length);
  refreshHud();
};
net.onStatus = (status, detail) => {
  const label =
    status === 'realtime'
      ? 'Live · realtime channel'
      : status === 'polling'
        ? 'Live · syncing'
        : status === 'error'
          ? 'Connection problem'
          : 'Offline';
  screens.setStatus(detail ? `${label} — ${detail}` : label, status === 'error' ? 'error' : 'live');
};

/* ------------------------------------------------------------------ *
 * Rendering the board state
 * ------------------------------------------------------------------ */

function addPieceView(square: Square, piece: Piece) {
  const materials = createPieceMaterials(piece.color);
  let group: THREE.Group = buildProceduralPiece(piece.type, piece.color, materials);
  group.userData.materials = [materials.body];

  const model = models.get(`${piece.color}:${piece.type}`);
  if (model) {
    group = new THREE.Group();
    const clone = model.clone(true);
    const glow: THREE.MeshStandardMaterial[] = [];
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as THREE.Material | THREE.Material[];
      const cloned = Array.isArray(source)
        ? source.map((material) => material.clone())
        : source.clone();
      mesh.material = cloned;
      for (const material of Array.isArray(cloned) ? cloned : [cloned]) {
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.emissive) {
          standard.emissive = new THREE.Color(0xffb347);
          standard.emissiveIntensity = 0;
          glow.push(standard);
        }
      }
    });
    group.add(clone);
    group.userData.materials = glow;
  } else {
    for (const material of group.userData.materials as THREE.MeshStandardMaterial[]) {
      material.emissive = new THREE.Color(0xffb347);
      material.emissiveIntensity = 0;
    }
  }

  const base = board.worldFromSquare(square);
  group.position.set(base.x, base.y, base.z);
  group.rotation.y = piece.color === 'b' ? Math.PI : 0;
  group.scale.setScalar(0.94);
  group.userData.type = piece.type;
  group.userData.color = piece.color;
  group.userData.square = square;
  group.userData.baseY = base.y;
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  pieceRoot.add(group);
  pieceViews.set(square, group);
  dropTweens.push({ group, t: 0, baseY: base.y });
}

function removePieceView(square: Square) {
  const group = pieceViews.get(square);
  if (!group) return;
  pieceRoot.remove(group);
  pieceViews.delete(square);
}

function syncBoard(state: AnyState) {
  const pos = parseFen(state.fen);
  const seen = new Set<Square>();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = pos.board[r * 8 + f];
      if (!piece) continue;
      const square = frToSquare(f, r);
      seen.add(square);
      const existing = pieceViews.get(square);
      if (
        existing &&
        existing.userData.type === piece.type &&
        existing.userData.color === piece.color
      ) {
        continue;
      }
      if (existing) removePieceView(square);
      addPieceView(square, piece);
    }
  }
  for (const square of [...pieceViews.keys()]) {
    if (!seen.has(square)) removePieceView(square);
  }
  if (selected && !pieceViews.has(selected)) {
    selected = null;
    legal = [];
  }
  updateOutline();
}

function updateOutline() {
  if (outline) {
    pieceRoot.remove(outline);
    outline = null;
  }
  if (!selected) {
    refreshHighlights();
    return;
  }
  const view = pieceViews.get(selected);
  if (view) {
    outline = buildOutline(view, 0xffd27a);
    outline.position.copy(view.position);
    outline.rotation.copy(view.rotation);
    pieceRoot.add(outline);
  }
  refreshHighlights();
}

/** Kings currently in check, so their square can glow red. */
function checkSquares(state: AnyState): Square[] {
  if (state.status !== 'playing') return [];
  const pos = parseFen(state.fen);
  const out: Square[] = [];
  for (const color of ['w', 'b'] as Color[]) {
    if (!inCheck(pos, color)) continue;
    const king = findKing(pos.board, color);
    if (king) out.push(king);
  }
  return out;
}

/** Check flags for the HUD: is the side to move checked, and can a six snipe
 *  out of it? Both are derived from the same shared rules the server enforces. */
function checkFlags(state: AnyState): { inCheck: boolean; snipeBlocked: boolean } {
  if (state.status !== 'playing') return { inCheck: false, snipeBlocked: false };
  const cast = state as GameState;
  if (!sideInCheck(cast)) return { inCheck: false, snipeBlocked: false };
  return { inCheck: true, snipeBlocked: !hasCheckShot(cast) };
}

/** A check message that replaces the usual turn blurb when it matters. */
function checkWarning(state: AnyState): string | null {
  if (state.status !== 'playing' || !canAct()) return null;
  const cast = state as GameState;
  if (!sideInCheck(cast)) return null;
  if (state.phase === 'choice') {
    return hasCheckShot(cast)
      ? 'Your king is in check — snipe the checking piece, or move to block.'
      : 'Your king is in check and no shot reaches the checking piece. You must move to block the check.';
  }
  if (state.phase === 'snipe') return 'Your king is in check — take out the checking piece.';
  return null;
}

function refreshHighlights() {
  if (aiming) return;
  const state = S();
  const check = checkSquares(state);
  if (selected && state.phase === 'move') {
    board.setHighlights({
      selected,
      moves: legal.filter((move) => !move.capture).map((move) => move.to),
      captures: legal.filter((move) => move.capture).map((move) => move.to),
      check,
    });
    return;
  }
  board.setHighlights({ selected: selected ?? null, check });
}

/* ------------------------------------------------------------------ *
 * Presentation (state change → animation + UI)
 * ------------------------------------------------------------------ */

function present(next: AnyState) {
  if (snipePlaying) {
    pendingState = next;
    return;
  }
  if (mode === 'online') online = next as PublicGameState;
  else solo = next as GameState;

  const action = next.lastAction;
  if (action?.type === 'snipe' && next.version !== snipeSeen) {
    snipeSeen = next.version;
    void playSnipe(next, action.result);
    return;
  }
  if (action?.type === 'roll') {
    aurevak.invoke();
    void die.roll(action.value, aurevak.handPoint());
  }
  finishPresent(next);
}

function finishPresent(state: AnyState) {
  selected = null;
  legal = [];
  syncBoard(state);
  refreshHud();
  hud.setMessage(checkWarning(state) ?? describe(state));
  playFeedback(state);
  maybeAiTurn();
}

/* ------------------------------------------------------------------ *
 * Game feel: one proportional bundle per event, never per frame
 * ------------------------------------------------------------------ */

const CAPTURE_WEIGHT: Record<string, number> = { p: 0.3, n: 0.55, b: 0.55, r: 0.7, q: 0.95, k: 0 };
const pops: { group: THREE.Group; t: number }[] = [];
let feedbackVersion = -1;
let hadCheck = false;

function popSquare(square: Square) {
  const view = pieceViews.get(square);
  if (view) pops.push({ group: view, t: 0 });
}

function playFeedback(state: AnyState) {
  if (state.version === feedbackVersion) return;
  feedbackVersion = state.version;

  const action = state.lastAction;
  if (action?.type === 'move') {
    if (action.capture) {
      stage.addTrauma(0.16 + (CAPTURE_WEIGHT[action.capture] ?? 0.4) * 0.5);
      stage.hitStop(70, 0.3);
      popSquare(action.to);
    } else {
      stage.addTrauma(0.055);
    }
  }

  const checked = checkSquares(state).length > 0;
  if (checked && !hadCheck) {
    stage.addTrauma(0.2);
    hud.flashCheck();
  }
  hadCheck = checked;
}

function flushPending() {
  if (!pendingState) return;
  const queued = pendingState;
  pendingState = null;
  present(queued);
}

async function playSnipe(state: AnyState, result: SnipeResult) {
  // A hidden tab cannot draw the cinematic — and browsers throttle its timers —
  // so it applies the outcome at once instead of drifting out of sync.
  if (document.visibilityState === 'hidden') {
    finishPresent(state);
    hud.setView(preferredView);
    stage.setView(preferredView);
    flushPending();
    return;
  }

  snipePlaying = true;
  hud.setBusy(true);
  aiming = null;
  aim.hide();
  hud.showAim(null);
  board.setHighlights({});

  const origin = board.worldFromSquare(result.from);
  const direction = new THREE.Vector3(Math.cos(result.dirAngle), 0, Math.sin(result.dirAngle));
  stage.setSniperView(origin, direction);
  hud.setView('sniper');

  await wait(220);
  // Browsers pause requestAnimationFrame in a background tab, so the effect
  // is bounded: a hidden player still applies the newer state and stays in
  // sync with the board instead of freezing on the shot.
  await Promise.race([shotfx.play(result), wait(2400)]);
  if (result.eliminated && result.hitSquare) knockDown(result);
  await wait(560);

  snipePlaying = false;
  finishPresent(state);
  stage.setView(preferredView);
  hud.setView(preferredView);
  hud.setBusy(false);

  flushPending();
}

function knockDown(result: SnipeResult) {
  const square = result.hitSquare;
  if (!square) return;
  const view = pieceViews.get(square);
  if (!view) return;
  pieceViews.delete(square);

  const direction = new THREE.Vector3(
    Math.cos(result.dirAngle),
    0,
    Math.sin(result.dirAngle),
  );
  const impulse = direction.clone().multiplyScalar(2.6).add(new THREE.Vector3(0, 1.7, 0));
  const body = physics.ready ? physics.spawnDebris(view.position.clone(), impulse) : null;
  if (body) {
    debris.push({ body, mesh: view, until: performance.now() + 1700 });
    return;
  }

  const startY = view.position.y;
  const started = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - started) / 720);
    if (t >= 1) {
      pieceRoot.remove(view);
      return;
    }
    view.position.addScaledVector(direction, 0.045);
    view.position.y = startY + Math.sin(t * Math.PI) * 0.9;
    view.rotation.z += 0.16;
    view.rotation.x += 0.09;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

async function withBusy(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  hud.setBusy(true);
  try {
    await fn();
  } catch (error) {
    hud.setMessage((error as Error).message);
  } finally {
    busy = false;
    hud.setBusy(false);
    refreshHud();
  }
}

async function rollDie() {
  if (busy || aiming) return;
  const state = S();
  if (state.status !== 'playing' || state.phase !== 'roll') return;
  if (!canAct()) {
    hud.setMessage('Waiting for your opponent to move.');
    return;
  }

  if (mode !== 'online') {
    const value = 1 + Math.floor(Math.random() * 6);
    const seed = Math.floor(Math.random() * 0xffffffff);
    solo = { ...applyRoll(solo, value, seed), version: solo.version + 1 };
    present(solo);
    return;
  }

  await withBusy(async () => {
    const response = await net.roll();
    present(response.state);
  });
}

function choose(choice: 'move' | 'snipe') {
  if (busy) return;
  const state = S();
  if (state.phase !== 'choice') return;
  if (!canAct()) return;

  if (mode !== 'online') {
    try {
      solo = { ...applyChoice(solo, choice), version: solo.version + 1 };
    } catch (error) {
      hud.setMessage((error as Error).message);
      return;
    }
    present(solo);
    hud.setMessage(
      choice === 'move'
        ? 'Pick a piece: the die offers six of its legal destinations.'
        : 'Pick one of your pieces, then drag away from it to aim.',
    );
    return;
  }

  void withBusy(async () => {
    const response = await net.choose(choice);
    present(response.state);
  });
}

function doMove(from: Square, to: Square) {
  if (mode !== 'online') {
    try {
      solo = { ...applyMove(solo, from, to), version: solo.version + 1 };
      present(solo);
    } catch (error) {
      hud.setMessage((error as Error).message);
    }
    return;
  }
  void withBusy(async () => {
    const response = await net.move(from, to);
    present(response.state);
  });
}

async function fireSnipe(shot: { from: Square; angle: number; power: number }) {
  aiming = null;
  aim.hide();
  hud.showAim(null);
  stage.controls.enabled = true;

  if (shot.power < 0.04) {
    board.setHighlights({ selected: shot.from });
    hud.setMessage('Pull further back, then release to fire.');
    return;
  }

  if (mode !== 'online') {
    try {
      const outcome = applySnipe(solo, shot.from, shot.angle, shot.power, solo.seed);
      solo = { ...outcome.state, version: solo.version + 1 };
      present(solo);
    } catch (error) {
      hud.setMessage((error as Error).message);
      refreshHighlights();
    }
    return;
  }

  await withBusy(async () => {
    const response = await net.snipe(shot.from, shot.angle, shot.power);
    present(response.state);
  });
}

function cancelSelection() {
  aiming = null;
  aim.hide();
  hud.showAim(null);
  selected = null;
  legal = [];
  board.setHighlights({});
  if (outline) {
    pieceRoot.remove(outline);
    outline = null;
  }
  stage.controls.enabled = stage.mode !== 'sniper';
}

function selectPiece(square: Square) {
  const state = S() as GameState;
  const piece = pieceAt(parseFen(state.fen), square);
  if (!piece || piece.color !== state.turn) return;
  if (!canAct()) {
    hud.setMessage('Waiting for your opponent.');
    return;
  }
  selected = square;
  legal = offeredMoves(state, square);
  updateOutline();
  hud.setMessage(
    legal.length
      ? `${PIECE_NAME[piece.type]} on ${square.toUpperCase()} · the die shows ${legal.length} destination${
          legal.length === 1 ? '' : 's'
        }.`
      : `That ${PIECE_NAME[piece.type].toLowerCase()} has no legal move.`,
  );
}

/* ------------------------------------------------------------------ *
 * Aiming
 * ------------------------------------------------------------------ */

function beginAim(square: Square, event: PointerEvent) {
  const start = board.worldFromSquare(square);
  aiming = { from: square, start, power: 0, angle: 0 };
  selected = square;
  legal = [];
  stage.controls.enabled = false;
  aim.show();
  hud.setMessage('Drag away from the piece to aim, then release to fire.');
  updateAim(event);
}

function updateAim(event: PointerEvent) {
  if (!aiming) return;
  const point = stage.projectToBoard(event.clientX, event.clientY);
  if (!point) return;

  const pull = new THREE.Vector3(aiming.start.x - point.x, 0, aiming.start.z - point.z);
  const power = clamp01(pull.length() / 3);
  const angle = Math.atan2(pull.z, pull.x);
  aiming.power = power;
  aiming.angle = angle;

  const state = S() as GameState;
  const preview = previewSnipe(state, aiming.from, angle, Math.max(power, 0.06));
  if (!preview) return;

  const end = preview.hitSquare ?? preview.blockedBy ?? preview.path[preview.path.length - 1] ?? null;
  // In check the aim guide only reads "on target" for the checking piece, so
  // a shot that cannot answer the check is never presented as a good idea.
  const checkers = sideInCheck(state) ? checkingPieces(state) : [];
  const answersCheck =
    !checkers.length ||
    Boolean(preview.eliminated && preview.hitSquare && checkers.includes(preview.hitSquare));
  aim.update({
    from: aiming.from,
    angle: preview.dirAngle,
    end,
    onTarget: answersCheck && Boolean(preview.hitSquare),
    blocked: !preview.hitSquare && Boolean(preview.blockedBy),
  });
  if (checkers.length && !answersCheck) {
    hud.setMessage('Your king is in check — aim at the checking piece.');
  }
  board.setHighlights({
    selected: aiming.from,
    path: preview.path,
    target: end,
  });
  hud.showAim({ power });
}

function endAim() {
  if (!aiming) return;
  const shot = { from: aiming.from, angle: aiming.angle, power: aiming.power };
  stage.controls.enabled = true;
  void fireSnipe(shot);
}

/* ------------------------------------------------------------------ *
 * Pointer input
 * ------------------------------------------------------------------ */

function pickSquare(event: PointerEvent): Square | null {
  const hits = stage.raycast(event.clientX, event.clientY, [...pieceViews.values()]);
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object;
    while (node) {
      const square = node.userData?.square as Square | undefined;
      if (square) return square;
      node = node.parent;
    }
  }
  const point = stage.projectToBoard(event.clientX, event.clientY);
  return point ? board.squareFromPoint(point) : null;
}

stage.renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (busy || snipePlaying) return;
  const state = S();
  if (aiming) {
    updateAim(event);
    return;
  }
  const square = pickSquare(event);
  if (!square) return;

  if (state.phase === 'snipe') {
    if (!canAct()) {
      hud.setMessage('Waiting for your opponent.');
      return;
    }
    const piece = pieceAt(parseFen(state.fen), square);
    if (piece && piece.color === state.turn) beginAim(square, event);
    else hud.setMessage('Choose one of your own pieces to aim.');
    return;
  }

  if (state.phase === 'move') {
    if (selected && legal.some((move) => move.to === square)) {
      doMove(selected, square);
      return;
    }
    if (!canAct()) {
      hud.setMessage('Waiting for your opponent.');
      return;
    }
    const piece = pieceAt(parseFen(state.fen), square);
    if (piece && piece.color === state.turn) selectPiece(square);
    else if (selected) {
      cancelSelection();
      hud.setMessage('Selection cleared.');
    }
    return;
  }

  if (state.phase === 'roll') {
    hud.setMessage('Roll the die first — it decides how many moves you are offered.');
    return;
  }
  if (state.phase === 'choice') {
    hud.setMessage('Choose a normal move or a snipe.');
    return;
  }
  if (state.status === 'finished') {
    hud.setMessage('This match is over. Start a new game for another.');
  }
});

stage.renderer.domElement.addEventListener('pointermove', (event) => {
  if (aiming) updateAim(event);
});

window.addEventListener('pointerup', () => {
  if (aiming) endAim();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (aiming) {
      aiming = null;
      aim.hide();
      hud.showAim(null);
      stage.controls.enabled = true;
      hud.setMessage('Shot cancelled.');
    }
    cancelSelection();
    refreshHud();
  }
});

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

function setView(view: 'bird' | 'human') {
  preferredView = view;
  stage.setView(view);
  hud.setView(view);
}

/* ------------------------------------------------------------------ *
 * Rooms
 * ------------------------------------------------------------------ */

function inviteLink(room: string) {
  return `${location.origin}${location.pathname}?room=${room}`;
}

async function copyInvite() {
  const room = net.session?.room;
  if (!room) return;
  try {
    await navigator.clipboard.writeText(inviteLink(room));
    screens.setStatus('Invite link copied.', 'live');
  } catch {
    screens.setStatus(inviteLink(room));
  }
}

async function createRoom() {
  try {
    const session = await net.createRoom();
    mode = 'online';
    myColor = session.color;
    playersConnected = 1;
    screens.setRoomInput(session.room);
    history.replaceState(null, '', `?room=${session.room}`);
    screens.setStatus(`Room ${session.room} created — share the code or link.`, 'live');
    if (net.lastState) present(net.lastState);
    screens.close();
    refreshHud();
    hud.setMessage('Room ready. Share the code, or send the invite link.');
  } catch (error) {
    screens.setStatus((error as Error).message, 'error');
  }
}

async function joinRoom(code: string) {
  const room = code.trim().toUpperCase();
  if (room.length !== 6) {
    screens.setStatus('Enter the six-character room code.', 'error');
    return;
  }
  try {
    const session = await net.joinRoom(room);
    mode = 'online';
    myColor = session.color;
    playersConnected = 2;
    screens.setRoomInput(session.room);
    history.replaceState(null, '', `?room=${session.room}`);
    screens.setStatus(
      session.color === 'b'
        ? `Joined ${session.room} as Black.`
        : `Reconnected to ${session.room} as White.`,
      'live',
    );
    if (net.lastState) present(net.lastState);
    screens.close();
    refreshHud();
  } catch (error) {
    screens.setStatus((error as Error).message, 'error');
  }
}

function startGame(kind: 'solo' | 'computer', skill?: Skill) {
  net.stop();
  net.session = null;
  mode = kind;
  if (kind === 'computer' && skill) aiSkill = skill;
  myColor = kind === 'computer' ? 'w' : null;
  online = null;
  playersConnected = kind === 'computer' ? 2 : 1;
  aiRunning = false;
  aiTurnId++;
  solo = { ...initialState(), version: 1 };
  snipeSeen = -1;
  pendingState = null;
  snipePlaying = false;
  feedbackVersion = -1;
  hadCheck = false;
  cancelSelection();
  syncBoard(solo);
  hud.closeOverlay();
  screens.close();
  screens.setRoom(null, null, 2);
  hud.setView(preferredView);
  stage.setView(preferredView);
  die.reset();
  die.setValue(1);
  hud.setMessage(
    kind === 'computer'
      ? `You are White against the computer (${aiSkill}). Roll the die to begin.`
      : 'Two players, one screen. White rolls first.',
  );
  refreshHud();
  history.replaceState(null, '', location.pathname);
}

function rematch() {
  hud.closeOverlay();
  if (mode === 'online') {
    screens.show('rooms');
    void createRoom();
    return;
  }
  startGame(mode === 'computer' ? 'computer' : 'solo', aiSkill);
}

function goToMenu() {
  net.stop();
  net.session = null;
  online = null;
  myColor = null;
  mode = 'solo';
  aiRunning = false;
  aiTurnId++;
  hud.closeOverlay();
  screens.setRoom(null, null, 2);
  screens.show('title');
}

/* ------------------------------------------------------------------ *
 * Computer opponent
 * ------------------------------------------------------------------ */

function maybeAiTurn() {
  if (mode !== 'computer' || aiRunning) return;
  const state = solo;
  if (state.status !== 'playing' || state.turn !== 'b') return;
  aiRunning = true;
  refreshHud();
  void runComputerTurn();
}

/** A legal fallback shot, used only if the sniper finds nothing worth hitting. */
function fallbackShot(state: GameState) {
  const shuffled = rankShots(state, aiSkill);
  if (shuffled[0]) return shuffled[0];
  const pos = parseFen(state.fen);
  for (let i = 0; i < 64; i++) {
    const piece = pos.board[i];
    if (!piece || piece.color !== 'b') continue;
    return { from: `${'abcdefgh'[i % 8]}${'87654321'[Math.floor(i / 8)]}`, angle: 0, power: 0.6 };
  }
  return null;
}

async function runComputerTurn() {
  const id = ++aiTurnId;
  const alive = () => mode === 'computer' && id === aiTurnId;
  try {
    // A beat of thinking time keeps the turn readable and lets the die settle.
    await wait(600);
    if (!alive()) return;

    let state = solo;
    if (state.phase === 'roll') {
      const value = 1 + Math.floor(Math.random() * 6);
      const seed = Math.floor(Math.random() * 0xffffffff);
      solo = { ...applyRoll(solo, value, seed), version: solo.version + 1 };
      present(solo);
      await wait(820);
      if (!alive()) return;
      state = solo;
    }

    if (state.phase === 'choice') {
      const wantsShot = hasShot(state, aiSkill);
      solo = { ...applyChoice(solo, wantsShot ? 'snipe' : 'move'), version: solo.version + 1 };
      present(solo);
      hud.setMessage(wantsShot ? 'The computer lines up a snipe.' : 'The computer takes the move.');
      await wait(wantsShot ? 760 : 420);
      if (!alive()) return;
      state = solo;
    }

    if (state.phase === 'move') {
      const move = decideAction(state, aiSkill).move;
      if (!move) return;
      solo = { ...applyMove(solo, move.from, move.to), version: solo.version + 1 };
      present(solo);
      return;
    }

    if (state.phase === 'snipe') {
      const shot = decideAction(state, aiSkill).shot ?? fallbackShot(state);
      if (!shot) return;
      const outcome = applySnipe(solo, shot.from, shot.angle, shot.power, solo.seed);
      solo = { ...outcome.state, version: solo.version + 1 };
      present(solo);
    }
  } catch (error) {
    hud.setMessage((error as Error).message);
  } finally {
    aiRunning = false;
    refreshHud();
  }
}

/* ------------------------------------------------------------------ *
 * Messaging
 * ------------------------------------------------------------------ */

function describe(state: AnyState): string {
  if (state.status === 'finished') return endMessage(state);
  const action = state.lastAction;
  if (state.status === 'waiting') return 'Room ready. Waiting for an opponent to join.';
  if (action?.type === 'roll') {
    return action.value === 6
      ? 'A six. Move with six offered squares, or snipe.'
      : `Rolled ${action.value}: ${action.value} move${action.value === 1 ? '' : 's'} offered per piece.`;
  }
  if (action?.type === 'move') {
    const mover = `${action.piece.toUpperCase()} ${action.from.toUpperCase()} → ${action.to.toUpperCase()}`;
    return action.capture
      ? `${mover} captures the ${PIECE_NAME[action.capture]}. ${turnText(state)}`
      : `${mover}. ${turnText(state)}`;
  }
  if (action?.type === 'snipe') {
    const result = action.result;
    if (result.eliminated && result.hitSquare && result.hitPiece) {
      return `Direct hit: the ${PIECE_NAME[result.hitPiece.type]} at ${result.hitSquare.toUpperCase()} is down. ${turnText(state)}`;
    }
    if (result.kingProtected) {
      return 'The king shrugs it off — only a king can snipe a king. Shot spent.';
    }
    if (result.veered) return 'The line drifted wide. Shot spent.';
    if (result.blockedBy) return `Stopped at ${result.blockedBy.toUpperCase()}. Shot spent.`;
    return `Clean miss. The shot slid ${result.travel.toFixed(1)} squares.`;
  }
  return state.turn === 'w' ? 'White to move.' : 'Black to move.';
}

function turnText(state: AnyState): string {
  return state.turn === 'w' ? 'White to move.' : 'Black to move.';
}

function endMessage(state: AnyState): string {
  if (!state.winner) return 'Stalemate — no legal moves remain.';
  const winner = state.winner === 'w' ? 'White' : 'Black';
  switch (state.endReason) {
    case 'checkmate':
      return `${winner} wins by checkmate.`;
    case 'elimination':
      return `${winner} wins — every enemy piece is gone.`;
    case 'king-snipe':
      return `${winner} wins by sniping the king.`;
    default:
      return `${winner} wins.`;
  }
}

function refreshHud() {
  const state = S();
  const flags = checkFlags(state);
  hud.sync(state, {
    myColor: mode === 'computer' ? 'w' : myColor,
    versus: mode !== 'solo',
    watching: mode === 'online' && playersConnected < 2,
    busy: busy || snipePlaying,
    aiming: Boolean(aiming),
    thinking: aiRunning,
    inCheck: flags.inCheck,
    snipeBlocked: flags.snipeBlocked,
  });
  // The board always faces the player who owns this browser: White from one
  // side of the table, Black from the other.
  const side: Color = mode === 'online' && myColor === 'b' ? 'b' : 'w';
  stage.setSide(side);
  aurevak.setSide(side);
  die.setSide(side);
  screens.setRoom(
    mode === 'online' ? net.session?.room ?? null : null,
    myColor,
    playersConnected,
  );
}

/* ------------------------------------------------------------------ *
 * Frame loop
 * ------------------------------------------------------------------ */

let last = performance.now();
let glowing: THREE.Group | null = null;

function frame(now: number) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = realDt * stage.timeScale;
  const time = now / 1000;

  if (physics.ready) physics.step(dt);
  die.update(now);
  aurevak.setFocus(die.position);
  aurevak.update(realDt, time);
  board.update(dt, time);

  for (let i = dropTweens.length - 1; i >= 0; i--) {
    const tween = dropTweens[i];
    tween.t = Math.min(1, tween.t + realDt * 3.4);
    const eased = 1 - Math.pow(1 - tween.t, 3);
    tween.group.position.y = tween.baseY + (1 - eased) * 0.55;
    tween.group.scale.setScalar(0.94 + 0.06 * eased);
    if (tween.t >= 1) dropTweens.splice(i, 1);
  }

  for (let i = debris.length - 1; i >= 0; i--) {
    const piece = debris[i];
    const transform = physics.read(piece.body);
    piece.mesh.position.copy(transform.position);
    piece.mesh.quaternion.copy(transform.quaternion);
    if (now > piece.until) {
      physics.remove(piece.body);
      pieceRoot.remove(piece.mesh);
      debris.splice(i, 1);
    }
  }

  // Landing pop: one short squash so a placement reads as contact.
  for (let i = pops.length - 1; i >= 0; i--) {
    const pop = pops[i];
    pop.t = Math.min(1, pop.t + realDt * 5.5);
    pop.group.scale.setScalar(0.94 * (1 + 0.1 * Math.sin(pop.t * Math.PI)));
    if (pop.t >= 1) {
      pop.group.scale.setScalar(0.94);
      pops.splice(i, 1);
    }
  }

  // Selection glow: only the selected piece and the one that just lost the
  // glow are touched. The old loop wrote a zero to every material every frame.
  const pulse = 0.5 + 0.5 * Math.sin(time * 5.2);
  const glowTarget = selected ? pieceViews.get(selected) ?? null : null;
  if (glowing && glowing !== glowTarget) {
    for (const material of (glowing.userData.materials as THREE.MeshStandardMaterial[]) ?? []) {
      material.emissiveIntensity = 0;
    }
  }
  if (glowTarget) {
    for (const material of (glowTarget.userData.materials as THREE.MeshStandardMaterial[]) ?? []) {
      material.emissiveIntensity = 0.05 + 0.06 * pulse;
    }
  }
  glowing = glowTarget;
  if (outline) {
    const material = outline.userData.material as THREE.MeshBasicMaterial;
    material.opacity = 0.12 + 0.1 * pulse;
    outline.scale.setScalar(1 + 0.004 * pulse);
  }

  // Shadow map is only re-rendered on frames something actually moved.
  if (
    snipePlaying ||
    die.animating ||
    dropTweens.length > 0 ||
    debris.length > 0 ||
    pops.length > 0
  ) {
    stage.invalidateShadows();
  }

  stage.update(dt, realDt);
  stage.render();
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  stage.setView('human');
  hud.setView('human');
  syncBoard(solo);
  refreshHud();
  hud.setMessage('Roll the die to begin. A six lets you move or snipe.');
  screens.setRoom(null, null, 2);

  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) screens.setRoomInput(roomParam.toUpperCase());

  const [, , loadedModels] = await Promise.all([
    physics.init(),
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
    loadPieceModels(),
  ]);
  models = loadedModels;

  // Rebuild with real models if any were found.
  for (const square of [...pieceViews.keys()]) removePieceView(square);
  syncBoard(S());
  physics.step(0.016);

  document.querySelector('#boot')?.setAttribute('hidden', '');
  screens.show('title');

  if (roomParam) {
    screens.push('rooms');
    const stored = net.storedToken(roomParam.toUpperCase());
    if (stored) {
      await joinRoom(roomParam);
    } else {
      screens.setStatus('Room code loaded — press Join to take the open seat.');
      screens.setRoomInput(roomParam.toUpperCase());
    }
  } else {
    try {
      const lastRoom = localStorage.getItem(LAST_ROOM_KEY);
      if (lastRoom && net.storedToken(lastRoom)) {
        screens.setRoomInput(lastRoom);
        screens.setStatus(`Rejoin room ${lastRoom} with one click.`);
      }
    } catch {
      /* ignore */
    }
  }

  requestAnimationFrame(frame);
}

void boot();

// Local-only introspection, used to drive the aim UI in automated checks.
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  (window as unknown as Record<string, unknown>).__diceChess = {
    get state() {
      return S();
    },
    get aiming() {
      return aiming;
    },
    aimVisible: () => aim.visible,
    screenPointOf(square: Square) {
      const point = board.worldFromSquare(square).clone().project(stage.camera);
      const rect = stage.renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (point.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-point.y * 0.5 + 0.5) * rect.height,
      };
    },
    pieceSquares: () => [...pieceViews.keys()],
    offersOf: (square: Square) => offeredMoves(S() as GameState, square).map((move) => move.to),
    get mode() {
      return mode;
    },
    get aiRunning() {
      return aiRunning;
    },
    frameStats: () => ({
      frameMs: +stage.frameTime.toFixed(2),
      renderScale: stage.renderScale,
    }),
    openScreen: (name: 'title' | 'rules' | 'rooms' | 'settings' | 'pause') => screens.show(name),
  };
}
