import type { Color } from '../shared/types';
import { SKILLS, type Skill } from '../shared/ai';

export type ScreenName = 'title' | 'rules' | 'rooms' | 'settings' | 'pause';

export interface ScreenHandlers {
  onStartComputer: (skill: Skill) => void;
  onStartLocal: () => void;
  onOpenRooms: () => void;
  onResume: () => void;
  onNewGame: () => void;
  onExitToMenu: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onCopyInvite: () => void;
  onToggleShake: (on: boolean) => void;
  onToggleMotion: (on: boolean) => void;
}

function $<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing screen element ${selector}`);
  return element;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

/**
 * Screen stack: only the top screen is visible and interactive, Escape pops it,
 * and the first control is focused on open so keyboard and gamepad players are
 * never stranded on a menu.
 */
export class Screens {
  private stack: ScreenName[] = [];
  private root = $('#screens');
  private elements = new Map<ScreenName, HTMLElement>();
  private skill: Skill = 'normal';
  private roomBadge = $('#roomBadge');
  private roomsStatus = $('#roomsStatus');
  private roomsInfo = $('#roomsInfo');
  private roomsCopy = $<HTMLButtonElement>('#roomsCopy');
  private roomInput = $<HTMLInputElement>('#roomInput');
  private handlers: ScreenHandlers;
  private lastFocused: HTMLElement | null = null;

  constructor(handlers: ScreenHandlers) {
    this.handlers = handlers;
    for (const el of document.querySelectorAll<HTMLElement>('[data-screen]')) {
      this.elements.set(el.dataset.screen as ScreenName, el);
    }

    $('#playComputerBtn').addEventListener('click', () => handlers.onStartComputer(this.skill));
    $('#playLocalBtn').addEventListener('click', () => handlers.onStartLocal());
    $('#openRoomsBtn').addEventListener('click', () => handlers.onOpenRooms());
    $('#openRulesBtn').addEventListener('click', () => this.push('rules'));
    $('#openSettingsBtn').addEventListener('click', () => this.push('settings'));
    $('#rulesBackBtn').addEventListener('click', () => this.back());
    $('#settingsBackBtn').addEventListener('click', () => this.back());
    $('#roomsBackBtn').addEventListener('click', () => this.back());
    $('#roomsCreateBtn').addEventListener('click', () => handlers.onCreateRoom());
    $('#roomsJoinBtn').addEventListener('click', () => handlers.onJoinRoom(this.roomInput.value));
    this.roomsCopy.addEventListener('click', () => handlers.onCopyInvite());
    this.roomInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handlers.onJoinRoom(this.roomInput.value);
    });
    $('#pauseResumeBtn').addEventListener('click', () => handlers.onResume());
    $('#pauseNewBtn').addEventListener('click', () => handlers.onNewGame());
    $('#pauseRulesBtn').addEventListener('click', () => this.push('rules'));
    $('#pauseSettingsBtn').addEventListener('click', () => this.push('settings'));
    $('#pauseMenuBtn').addEventListener('click', () => handlers.onExitToMenu());

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-skill]')) {
      button.addEventListener('click', () => this.setSkill(button.dataset.skill as Skill));
    }
    $('#shakeToggle').addEventListener('change', (event) =>
      handlers.onToggleShake((event.target as HTMLInputElement).checked),
    );
    $('#motionToggle').addEventListener('change', (event) =>
      handlers.onToggleMotion((event.target as HTMLInputElement).checked),
    );

    // Escape steps back through the stack; arrows move focus inside a screen so
    // a gamepad or TV remote can reach everything without a pointer.
    window.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (this.stack.length > 1) this.back();
        else if (this.stack[0] === 'pause') this.handlers.onResume();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveFocus(event.key === 'ArrowDown' ? 1 : -1);
      }
    });

    this.setSkill(this.skill);
    this.setRoom(null, null, 2);
  }

  get isOpen() {
    return this.stack.length > 0;
  }

  get top(): ScreenName | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Replace the stack with one screen. */
  show(name: ScreenName) {
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.stack = [name];
    this.render();
  }

  push(name: ScreenName) {
    this.stack.push(name);
    this.render();
  }

  back() {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    this.render();
  }

  close() {
    this.stack = [];
    this.render();
    this.lastFocused?.focus?.();
  }

  private render() {
    const top = this.top;
    this.root.hidden = !top;
    document.body.classList.toggle('screen-open', Boolean(top));
    // The board is behind a screen: keep it out of the tab order and off the
    // accessibility tree so focus never escapes the open menu.
    const app = document.querySelector<HTMLElement>('#app');
    if (app) {
      app.setAttribute('aria-hidden', String(Boolean(top)));
      if ('inert' in app) (app as HTMLElement & { inert: boolean }).inert = Boolean(top);
    }
    for (const [name, element] of this.elements) {
      const active = name === top;
      element.hidden = !active;
      // Keep background screens out of the tab order entirely.
      element.setAttribute('aria-hidden', String(!active));
      if ('inert' in element) (element as HTMLElement & { inert: boolean }).inert = !active;
    }
    if (!top) return;
    const focusTarget =
      this.elements.get(top)?.querySelector<HTMLElement>('[data-autofocus]') ??
      this.elements.get(top)?.querySelector<HTMLElement>(FOCUSABLE);
    focusTarget?.focus({ preventScroll: true });
  }

  private moveFocus(step: number) {
    const screen = this.top ? this.elements.get(this.top) : null;
    if (!screen) return;
    const items = [...screen.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => item.offsetParent !== null,
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = (current + step + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  setSkill(skill: Skill) {
    this.skill = skill;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-skill]')) {
      const active = button.dataset.skill === skill;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    }
    const blurb = SKILLS.find((entry) => entry.id === skill)?.blurb ?? '';
    const hint = document.querySelector('#skillBlurb');
    if (hint) hint.textContent = blurb;
  }

  get difficulty() {
    return this.skill;
  }

  setStatus(text: string, tone: 'idle' | 'live' | 'error' = 'idle') {
    this.roomsStatus.textContent = text;
    this.roomsStatus.dataset.tone = tone;
  }

  setRoomInput(code: string) {
    this.roomInput.value = code;
  }

  setRoom(room: string | null, color: Color | null, players: number) {
    const label = room
      ? `Room ${room} · ${color ? (color === 'w' ? 'White' : 'Black') : 'spectator'} · ${players}/2`
      : '';
    this.roomBadge.textContent = label;
    this.roomBadge.hidden = !room;
    this.roomsInfo.hidden = !room;
    this.roomsCopy.hidden = !room;
    if (room) {
      const role = color ? (color === 'w' ? 'White' : 'Black') : 'spectator';
      this.roomsInfo.innerHTML = `Room <strong>${room}</strong> · you are <strong>${role}</strong> · ${players}/2 connected`;
    }
  }

  setSettings(shake: boolean, reduceMotion: boolean) {
    $<HTMLInputElement>('#shakeToggle').checked = shake;
    $<HTMLInputElement>('#motionToggle').checked = reduceMotion;
  }
}
