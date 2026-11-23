import * as THREE from 'three';
import type { Square, SnipeResult } from '../shared/types';
import type { BoardView } from './board3d';
import type { Stage } from './stage';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Aiming reticle: a ring with crosshair ticks, drawn on a sprite so it always
 *  faces the camera and stays readable from any orbit angle. */
function crosshairTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';

  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(c, c, 40, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 4;
  for (const [x1, y1, x2, y2] of [
    [c, 3, c, 22],
    [c, size - 3, c, size - 22],
    [3, c, 22, c],
    [size - 3, c, size - 22, c],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(c, c, 4, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Aiming UI: one firing line from the shooter along its locked movement line,
 * and a crosshair that slides along the board with the pull. That is all the
 * player needs to read a shot.
 */
export class AimGuide {
  readonly group = new THREE.Group();
  private beam: THREE.Mesh;
  private crosshair: THREE.Sprite;
  private colour = new THREE.Color(0xffcf72);

  constructor(private board: BoardView) {
    // A slanted cylinder reads as a solid, bright line from any orbit angle;
    // depthTest is off so it is never swallowed by the pieces it crosses.
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 1, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffcf72,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.beam.renderOrder = 5;
    this.group.add(this.beam);

    this.crosshair = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: crosshairTexture(),
        color: 0xffd08a,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.crosshair.scale.setScalar(0.95);
    this.crosshair.renderOrder = 6;
    this.group.add(this.crosshair);

    this.group.visible = false;
  }

  show() {
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  get visible() {
    return this.group.visible;
  }

  update(input: {
    from: Square;
    angle: number;
    end: Square | null;
    onTarget: boolean;
    blocked: boolean;
  }) {
    const origin = this.board.worldFromSquare(input.from);
    this.colour.set(input.onTarget ? 0xff8a5c : input.blocked ? 0x9fd8ff : 0xffcf72);

    const endpoint = input.end
      ? this.board.worldFromSquare(input.end)
      : origin
          .clone()
          .add(new THREE.Vector3(Math.cos(input.angle), 0, Math.sin(input.angle)).multiplyScalar(1.1));

    const start = new THREE.Vector3(origin.x, origin.y + 0.34, origin.z);
    const stop = new THREE.Vector3(endpoint.x, endpoint.y + 0.34, endpoint.z);
    const length = start.distanceTo(stop);
    this.beam.position.copy(start).lerp(stop, 0.5);
    this.beam.scale.set(1, Math.max(0.001, length), 1);
    this.beam.visible = length > 0.05;
    if (length > 0.05) {
      this.beam.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        stop.clone().sub(start).normalize(),
      );
    }
    (this.beam.material as THREE.MeshBasicMaterial).color.copy(this.colour);

    this.crosshair.position.set(endpoint.x, endpoint.y + 0.38, endpoint.z);
    const material = this.crosshair.material as THREE.SpriteMaterial;
    material.color.copy(this.colour);
    material.opacity = 0.95;
  }
}

/** Projectile, flash, tracer and dust for a resolved snipe. */
export class ShotFX {
  private group = new THREE.Group();
  private projectile: THREE.Mesh;
  private glow: THREE.Sprite;
  private tracer: THREE.Mesh;
  private flash: THREE.PointLight;
  private running = false;

  constructor(private stage: Stage, private board: BoardView) {
    this.projectile = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff0c4 }),
    );
    this.group.add(this.projectile);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,236,180,1)');
    gradient.addColorStop(0.4, 'rgba(255,178,80,0.55)');
    gradient.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: 0xffd39a,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.scale.setScalar(0.9);
    this.group.add(this.glow);

    this.tracer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd08a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.group.add(this.tracer);

    this.flash = new THREE.PointLight(0xffc07a, 0, 6, 2);
    this.group.add(this.flash);
    this.group.visible = false;
    stage.add(this.group);
  }

  /**
   * Plays the shot exactly as the server resolved it, for both players.
   * The projectile arcs above the pieces so it is never lost behind them.
   * Resolves once the projectile has landed (impact effects keep running).
   */
  async play(result: SnipeResult): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.group.visible = true;

    const start = this.board.worldFromSquare(result.from);
    start.y += 0.62;
    const squares = result.path.length ? result.path : [result.from];
    const points: THREE.Vector3[] = [start];
    const steps = Math.max(1, squares.length);
    squares.forEach((square, index) => {
      const point = this.board.worldFromSquare(square);
      const t = (index + 1) / steps;
      point.y += 0.42 + 0.85 * Math.sin(Math.PI * Math.min(1, t));
      points.push(point);
    });

    this.projectile.position.copy(start);
    this.glow.position.copy(start);
    const tracerMaterial = this.tracer.material as THREE.MeshBasicMaterial;
    tracerMaterial.opacity = 0.55;

    const duration = 320 + Math.min(280, points.length * 46);
    const started = performance.now();
    const pathCurve = new THREE.CatmullRomCurve3(points);

    await new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - started) / duration);
        const point = pathCurve.getPointAt(t);
        this.projectile.position.copy(point);
        this.glow.position.copy(point);
        this.flash.position.copy(point);
        this.flash.intensity = 1.2;

        const tail = pathCurve.getPointAt(Math.max(0, t - 0.12));
        const length = tail.distanceTo(point);
        if (length > 0.02) {
          this.tracer.position.copy(tail).lerp(point, 0.5);
          this.tracer.scale.set(1, length, 1);
          this.tracer.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            point.clone().sub(tail).normalize(),
          );
        }
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

    this.stage.addTrauma(result.hitSquare ? 0.85 : 0.35);
    this.stage.hitStop(result.hitSquare ? 190 : 90, 0.3);
    this.burst(points[points.length - 1], !!result.hitSquare);

    await wait(140);
    tracerMaterial.opacity = 0;
    this.flash.intensity = 0;
    this.projectile.visible = false;
    this.glow.visible = false;
    await wait(380);
    this.group.visible = false;
    this.projectile.visible = true;
    this.glow.visible = true;
    this.running = false;
    void this.tracer;
  }

  private burst(at: THREE.Vector3, strong: boolean) {
    const count = strong ? 46 : 18;
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = at.x;
      positions[i * 3 + 1] = at.y;
      positions[i * 3 + 2] = at.z;
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 3.4,
          Math.random() * 2.6,
          (Math.random() - 0.5) * 3.4,
        ),
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: strong ? 0xffbe72 : 0xcfe3ff,
      size: 0.06,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    this.stage.add(points);

    const started = performance.now();
    const tick = () => {
      const t = (performance.now() - started) / 700;
      if (t >= 1) {
        this.stage.scene.remove(points);
        geometry.dispose();
        material.dispose();
        return;
      }
      const attribute = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        velocities[i].y -= 6.2 * (1 / 60);
        attribute.setXYZ(
          i,
          attribute.getX(i) + velocities[i].x * 0.016,
          Math.max(0.1, attribute.getY(i) + velocities[i].y * 0.016),
          attribute.getZ(i) + velocities[i].z * 0.016,
        );
      }
      attribute.needsUpdate = true;
      material.opacity = 0.95 * (1 - t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
