import type { Color, GameState, PublicGameState } from '../shared/types';

function $<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing HUD element ${selector}`);
  return element;
}

export interface HudHandlers {
  onRoll: () => void;
  onChoose: (choice: 'move' | 'snipe') => void;
  onView: (mode: 'bird' | 'human') => void;
  onMenu: () => void;
  onPlayAgain: () => void;
  onExitToMenu: () => void;
}

export interface AimModel {
  power: number;
}

export interface HudSyncOptions {
  myColor: Color | null;
  /** A real opponent (another browser or the computer) controls the other side. */
  versus: boolean;
  watching: boolean;
  busy: boolean;
  aiming: boolean;
  thinking: boolean;
  /** The side to move is in check. */
  inCheck: boolean;
  /** In check with no shot that can reach the checking piece. */
  snipeBlocked: boolean;
}

/**
 * HUD driven by game events, never by frame polling. Layout scales with
 * clamp(), respects safe areas, and keeps one clear primary action.
 */
export class Hud {
  private turnName = $<HTMLElement>('#turnName');
  private turnCard = $<HTMLElement>('#turnCard');
  private dieValue = $<HTMLElement>('#dieValue');
  private dieCard = $<HTMLElement>('#dieCard');
  private message = $<HTMLElement>('#message');
  private checkFlash = $<HTMLElement>('#checkFlash');
  private rollBtn = $<HTMLButtonElement>('#rollBtn');
  private choiceRow = $<HTMLElement>('#choiceRow');
  private moveChoice = $<HTMLButtonElement>('#moveChoice');
  private snipeChoice = $<HTMLButtonElement>('#snipeChoice');
  private dockStatus = $<HTMLElement>('#dockStatus');
  private aimPanel = $<HTMLElement>('#aimPanel');
  private powerFill = $<HTMLElement>('#powerFill');
  private powerText = $<HTMLElement>('#powerText');
  private dock = $<HTMLElement>('#dock');
  private gameOver = $<HTMLElement>('#gameOver');
  private resultTitle = $<HTMLElement>('#resultTitle');
  private resultText = $<HTMLElement>('#resultText');
  private viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
  private activeView: 'bird' | 'human' | 'sniper' = 'human';
  private lastTurn: Color | null = null;
  private lastDie = 0;

  constructor(private handler: HudHandlers) {
    this.rollBtn.addEventListener('click', handler.onRoll);
    this.moveChoice.addEventListener('click', () => handler.onChoose('move'));
    this.snipeChoice.addEventListener('click', () => handler.onChoose('snipe'));
    for (const button of this.viewButtons) {
      button.addEventListener('click', () => {
        handler.onView(button.dataset.view as 'bird' | 'human');
      });
    }
    $<HTMLButtonElement>('#menuBtn').addEventListener('click', handler.onMenu);
    $<HTMLButtonElement>('#playAgainBtn').addEventListener('click', handler.onPlayAgain);
    $<HTMLButtonElement>('#menuAfterBtn').addEventListener('click', handler.onExitToMenu);
  }

  setMessage(text: string) {
    if (this.message.textContent === text) return;
    this.message.textContent = text;
    // A short pop sells the update without moving anything else.
    this.message.removeAttribute('data-pop');
    void this.message.offsetWidth;
    this.message.setAttribute('data-pop', '');
  }

  /** One-shot red pulse when a king is first checked. */
  flashCheck() {
    this.checkFlash.removeAttribute('data-on');
    void this.checkFlash.offsetWidth;
    this.checkFlash.setAttribute('data-on', '');
  }

  setBusy(busy: boolean) {
    this.dock.classList.toggle('busy', busy);
  }

  setView(mode: 'bird' | 'human' | 'sniper') {
    this.activeView = mode;
    for (const button of this.viewButtons) {
      const active = button.dataset.view === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  sync(
    state: PublicGameState | GameState,
    options: HudSyncOptions,
  ) {
    const mine = options.myColor;
    const myTurn = !options.versus || (mine !== null && state.turn === mine);
    this.turnName.textContent = state.turn === 'w' ? 'White' : 'Black';
    this.turnName.dataset.color = state.turn;
    if (this.lastTurn && this.lastTurn !== state.turn) {
      this.turnCard.removeAttribute('data-pop');
      void this.turnCard.offsetWidth;
      this.turnCard.setAttribute('data-pop', '');
    }
    this.lastTurn = state.turn;

    const die = state.die ?? 0;
    this.dieValue.textContent = state.die ? String(state.die) : '—';
    this.dieValue.dataset.value = String(die);
    if (die !== this.lastDie) {
      this.dieValue.removeAttribute('data-pop');
      void this.dieValue.offsetWidth;
      this.dieValue.setAttribute('data-pop', '');
      this.lastDie = die;
    }

    const finished = state.status === 'finished';
    const canRoll = !finished && state.phase === 'roll' && myTurn && !options.watching;
    this.rollBtn.disabled = !canRoll || options.busy || options.thinking;
    this.rollBtn.textContent = state.die ? 'Roll again' : 'Roll die';
    this.choiceRow.hidden = !(state.phase === 'choice' && myTurn && !options.watching);
    this.moveChoice.disabled = options.busy || options.thinking;
    this.snipeChoice.disabled = options.busy || options.thinking || options.snipeBlocked;
    this.snipeChoice.textContent = options.snipeBlocked ? 'Snipe blocked' : 'Snipe';
    this.snipeChoice.title = options.snipeBlocked
      ? 'Your king is in check — no shot reaches the checking piece, so you must move to block.'
      : '';
    if (state.die) this.moveChoice.textContent = `Move · ${state.die}`;
    this.dock.classList.toggle('aiming', options.aiming);

    const status = (text: string, warn = false) => {
      this.dockStatus.textContent = text;
      this.dockStatus.classList.toggle('warn', warn);
    };

    if (finished) {
      status('Match complete');
    } else if (options.watching) {
      status('Waiting for an opponent to join…');
    } else if (options.thinking) {
      status('Computer is thinking…');
    } else if (!myTurn && options.versus) {
      status('Opponent to move');
    } else if (state.phase === 'roll') {
      status(`Roll for your ${state.turn === 'w' ? 'White' : 'Black'} turn`);
    } else if (state.phase === 'choice') {
      if (options.snipeBlocked) {
        status('Check! No snipe reaches the checker — move to block it.', true);
      } else if (options.inCheck) {
        status('A six: snipe the checking piece, or move to block.', true);
      } else {
        status('A six: move or snipe');
      }
    } else if (state.phase === 'snipe') {
      status(
        options.inCheck
          ? 'In check — your shot must take the checking piece'
          : 'Pick a piece, then drag to aim',
        options.inCheck,
      );
    } else {
      status(
        options.inCheck
          ? 'Check! Move to block, capture the attacker, or step away.'
          : `Die ${state.die ?? 0} · select a piece to see its offers`,
        options.inCheck,
      );
    }

    this.gameOver.hidden = !finished;
    if (finished) {
      this.resultTitle.textContent = resultTitle(state);
      this.resultText.textContent = resultText(state);
    }
  }

  showAim(model: AimModel | null) {
    this.aimPanel.hidden = !model;
    if (!model) return;
    const percent = Math.round(model.power * 100);
    this.powerFill.style.width = `${percent}%`;
    this.powerFill.dataset.level = percent > 82 ? 'high' : percent > 45 ? 'mid' : 'low';
    this.powerText.textContent = `${percent}%`;
  }

  closeOverlay() {
    this.gameOver.hidden = true;
  }

  get view() {
    return this.activeView;
  }

  get handlers() {
    return this.handler;
  }
}

function resultTitle(state: PublicGameState | GameState): string {
  if (!state.winner) return 'Stalemate';
  const winner = state.winner === 'w' ? 'White' : 'Black';
  switch (state.endReason) {
    case 'checkmate':
      return `${winner} wins by checkmate`;
    case 'elimination':
      return `${winner} wipes out the opposition`;
    case 'king-snipe':
      return `${winner} snipes the king`;
    default:
      return `${winner} wins`;
  }
}

function resultText(state: PublicGameState | GameState): string {
  if (!state.winner) return 'No legal moves remain. The game is drawn.';
  return 'Play again with the same settings, or head back to the menu.';
}
