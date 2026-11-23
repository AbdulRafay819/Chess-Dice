import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { parseFen, squareToFR, frToSquare, type Position } from '../shared/board';
import type { Square } from '../shared/types';
import { createBoardMaterials, type BoardMaterials } from './materials';
import { radialSprite } from './textures';

const HALF = 4.75;
const SQUARE_TOP = 0.085;

type HighlightKind =
  | 'selected'
  | 'move'
  | 'capture'
  | 'target'
  | 'hover'
  | 'path'
  | 'check';

const HIGHLIGHT_COLOR: Record<HighlightKind, number> = {
  selected: 0xffcf72,
  move: 0x4fe3b0,
  capture: 0xff7a6b,
  target: 0xffb347,
  hover: 0x9fd8ff,
  path: 0xff8c42,
  check: 0xff2a2a,
};

export class BoardView {
  readonly group = new THREE.Group();
  readonly materials: BoardMaterials;
  private squares: { f: number; r: number; mesh: THREE.Mesh }[] = [];
  private squareMeshes: THREE.Mesh[] = [];
  private highlightGroup = new THREE.Group();
  private highlights = new Map<Square, { mesh: THREE.Mesh; kind: HighlightKind }>();
  private checkGlow: THREE.Texture | null = null;
  private checkLight = new THREE.PointLight(0xff2a2a, 0, 3.4, 2);
  private time = 0;

  constructor() {
    this.materials = createBoardMaterials();
    this.group.add(this.highlightGroup);
    // Red spill so a checked king is unmistakable even on a busy board.
    this.checkLight.position.set(0, SQUARE_TOP + 0.3, 0);
    this.group.add(this.checkLight);
    this.buildFrame();
    this.buildSquares();
  }

  private buildFrame() {
    const outer = new THREE.Shape();
    outer.moveTo(-HALF, -HALF);
    outer.lineTo(HALF, -HALF);
    outer.lineTo(HALF, HALF);
    outer.lineTo(-HALF, HALF);
    outer.closePath();

    const hole = new THREE.Path();
    const inner = 4.06;
    hole.moveTo(-inner, -inner);
    hole.lineTo(-inner, inner);
    hole.lineTo(inner, inner);
    hole.lineTo(inner, -inner);
    hole.closePath();
    outer.holes.push(hole);

    const geometry = new THREE.ExtrudeGeometry(outer, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.07,
      bevelSegments: 4,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    const frame = new THREE.Mesh(geometry, this.materials.frame);
    frame.position.y = -0.4;
    frame.receiveShadow = true;
    frame.castShadow = true;
    this.group.add(frame);

    // Dark inlay under the playing surface.
    const inlay = new THREE.Mesh(
      new RoundedBoxGeometry(8.22, 0.3, 8.22, 3, 0.04),
      this.materials.inlay,
    );
    inlay.position.y = -0.16;
    inlay.receiveShadow = true;
    this.group.add(inlay);

    // Thin brass line where the inlay meets the frame.
    const trim = new THREE.Mesh(new THREE.TorusGeometry(4.11, 0.012, 6, 4), this.materials.trim);
    trim.rotation.x = -Math.PI / 2;
    trim.rotation.z = Math.PI / 4;
    trim.position.y = -0.005;
    this.group.add(trim);

    // Board underside, so the table edge reads as solid.
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(9.3, 0.34, 9.3, 3, 0.08),
      this.materials.frame,
    );
    base.position.y = -0.86;
    base.receiveShadow = true;
    base.castShadow = true;
    this.group.add(base);
  }

  private buildSquares() {
    const geometry = new RoundedBoxGeometry(0.965, 0.075, 0.965, 2, 0.014);
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const isLight = (f + r) % 2 === 0;
        const mesh = new THREE.Mesh(
          geometry,
          isLight ? this.materials.light : this.materials.dark,
        );
        mesh.position.set(f - 3.5, SQUARE_TOP - 0.0375, r - 3.5);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData.f = f;
        mesh.userData.r = r;
        this.squares.push({ f, r, mesh });
        this.squareMeshes.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  get raycastTargets(): THREE.Mesh[] {
    return this.squareMeshes;
  }

  worldFromSquare(square: Square): THREE.Vector3 {
    const { f, r } = squareToFR(square);
    return new THREE.Vector3(f - 3.5, SQUARE_TOP, r - 3.5);
  }

  squareFromPoint(point: THREE.Vector3): Square | null {
    const f = Math.round(point.x + 3.5);
    const r = Math.round(point.z + 3.5);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return frToSquare(f, r);
  }

  positionFromFen(fen: string): Position {
    return parseFen(fen);
  }

  private tile(square: Square, kind: HighlightKind): THREE.Mesh {
    const existing = this.highlights.get(square);
    if (existing && existing.kind === kind) return existing.mesh;
    // A square changing role (say a path tile becoming a target) must drop the
    // old mesh, otherwise it stays lit on the board for the rest of the game.
    if (existing) {
      this.highlightGroup.remove(existing.mesh);
      existing.mesh.geometry.dispose();
      (existing.mesh.material as THREE.Material).dispose();
      this.highlights.delete(square);
    }

    const color = HIGHLIGHT_COLOR[kind];
    const baseOpacity = kind === 'check' ? 1 : kind === 'selected' ? 0.44 : 0.34;
    // The check warning is a soft red halo rather than a flat tile, so it reads
    // as a glow spilling out from under the king.
    if (kind === 'check' && !this.checkGlow) this.checkGlow = radialSprite('#ff4136');
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(kind === 'check' ? 1.35 : 0.9, kind === 'check' ? 1.35 : 0.9),
      new THREE.MeshBasicMaterial({
        color,
        map: kind === 'check' ? this.checkGlow : null,
        transparent: true,
        opacity: baseOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    const base = this.worldFromSquare(square);
    mesh.position.set(base.x, SQUARE_TOP + 0.006, base.z);
    mesh.renderOrder = 3;
    mesh.userData.baseOpacity = baseOpacity;
    mesh.userData.phase = Math.random() * Math.PI * 2;
    this.highlightGroup.add(mesh);
    this.highlights.set(square, { mesh, kind });
    return mesh;
  }

  setHighlights(spec: {
    selected?: Square | null;
    moves?: Square[];
    captures?: Square[];
    target?: Square | null;
    path?: Square[];
    hover?: Square | null;
    check?: Square[];
  }) {
    const wanted = new Set<Square>();
    const put = (square: Square | null | undefined, kind: HighlightKind) => {
      if (!square) return;
      wanted.add(square);
      this.tile(square, kind);
    };

    put(spec.selected, 'selected');
    for (const square of spec.moves ?? []) put(square, 'move');
    for (const square of spec.captures ?? []) put(square, 'capture');
    for (const square of spec.path ?? []) put(square, 'path');
    put(spec.target, 'target');
    put(spec.hover, 'hover');
    // Last, so a checked king reads red even while selected.
    for (const square of spec.check ?? []) put(square, 'check');

    const checked = spec.check?.[0];
    if (checked) {
      const base = this.worldFromSquare(checked);
      this.checkLight.position.set(base.x, SQUARE_TOP + 0.3, base.z);
      this.checkLight.intensity = 2.4;
    } else {
      this.checkLight.intensity = 0;
    }

    for (const [square, entry] of this.highlights) {
      if (wanted.has(square)) continue;
      this.highlightGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
      this.highlights.delete(square);
    }
  }

  pulseTargets(points: { x: number; z: number }[]) {
    void points;
  }

  update(dt: number, time: number) {
    this.time = time;
    for (const entry of this.highlights.values()) {
      const material = entry.mesh.material as THREE.MeshBasicMaterial;
      const base = entry.mesh.userData.baseOpacity as number;
      const phase = entry.mesh.userData.phase as number;
      material.opacity = base * (0.72 + 0.28 * Math.sin(time * 3.2 + phase));
    }
    void dt;
  }

  dispose() {
    for (const entry of this.highlights.values()) {
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
  }

  get surfaceY(): number {
    return SQUARE_TOP;
  }

  get halfSize(): number {
    return HALF;
  }
}
