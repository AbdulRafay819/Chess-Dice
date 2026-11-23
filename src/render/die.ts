import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Physics } from './physics';

const SIZE = 0.62;
const HALF = SIZE / 2;
// Resting spot on the near frame rail, clear of the playing surface so the die
// never sits inside the h1 rook.
const REST = new THREE.Vector3(-3.1, 0.44, 4.4);

/** value → local face normal, arranged so opposite faces sum to seven. */
const FACE_NORMAL: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(1, 0, 0),
  5: new THREE.Vector3(-1, 0, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
};

const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
};

function restQuaternion(value: number): THREE.Quaternion {
  const normal = FACE_NORMAL[value] ?? FACE_NORMAL[1];
  const align = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 1, 0));
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.18);
  return yaw.multiply(align);
}

/**
 * Rounded die with real inset pip geometry. It tumbles in Rapier and always
 * settles showing the value the server rolled.
 */
export class Die {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private body: ReturnType<Physics['spawnDie']> = null;
  private target = restQuaternion(1);
  private settleFrom = new THREE.Vector3();
  private settleFromQuat = new THREE.Quaternion();
  private settling = false;
  private settleT = 0;
  private rollUntil = 0;
  private resolve: (() => void) | null = null;
  private tumbling = false;
  private faceUp = 1;

  constructor(private physics: Physics) {
    const geometry = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, 0.085);
    const ivory = new THREE.MeshPhysicalMaterial({
      color: 0xf2e7d3,
      roughness: 0.28,
      metalness: 0.02,
      clearcoat: 0.75,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.1,
    });
    this.mesh = new THREE.Mesh(geometry, ivory);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    const pipGeometry = new THREE.SphereGeometry(0.048, 18, 12);
    const pipMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x14161d,
      roughness: 0.35,
      metalness: 0.15,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
    });
    const up = new THREE.Vector3(0, 0, 1);

    for (const [valueText, layout] of Object.entries(PIP_LAYOUT)) {
      const value = Number(valueText);
      const normal = FACE_NORMAL[value];
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
      const down = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
      for (const [u, v] of layout) {
        const pip = new THREE.Mesh(pipGeometry, pipMaterial);
        pip.position
          .copy(normal)
          .multiplyScalar(HALF - 0.008)
          .addScaledVector(right, u * HALF * 0.52)
          .addScaledVector(down, v * HALF * 0.52);
        pip.scale.set(1, 1, 0.4);
        pip.quaternion.copy(quaternion);
        this.mesh.add(pip);
      }
    }

    this.reset();
  }

  reset() {
    this.physics.remove(this.body);
    this.body = null;
    this.tumbling = false;
    this.settling = false;
    this.group.visible = true;
    this.group.position.copy(REST);
    this.mesh.quaternion.copy(restQuaternion(this.faceUp));
    this.resolve?.();
    this.resolve = null;
  }

  /** Tumble, then settle showing `value`. Resolves when it has come to rest. */
  async roll(value: number): Promise<void> {
    this.faceUp = value;
    this.target = restQuaternion(value);
    this.resolve?.();
    this.settling = false;
    this.tumbling = true;
    this.group.visible = true;

    const from = new THREE.Vector3(-2.6 + Math.random() * 1.6, 2.4, 1.2);
    const impulse = new THREE.Vector3(
      (Math.random() - 0.5) * 0.32,
      -0.02,
      0.22 + Math.random() * 0.12,
    );
    this.body = this.physics.ready ? this.physics.spawnDie(from, impulse) : null;
    if (!this.body) {
      this.group.position.copy(from);
    }
    this.rollUntil = performance.now() + 1250;

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  update(now: number) {
    if (this.body) {
      const { position, quaternion } = this.physics.read(this.body);
      this.group.position.copy(position);
      this.mesh.quaternion.copy(quaternion);
      if (now > this.rollUntil) {
        this.physics.remove(this.body);
        this.body = null;
        this.beginSettle();
      }
      return;
    }

    if (this.tumbling && !this.settling) {
      this.beginSettle();
    }

    if (this.settling) {
      this.settleT = Math.min(1, this.settleT + 0.055);
      const eased = 1 - Math.pow(1 - this.settleT, 3);
      this.group.position.lerpVectors(this.settleFrom, REST, eased);
      this.mesh.quaternion.slerpQuaternions(this.settleFromQuat, this.target, eased);
      if (this.settleT >= 1) {
        this.settling = false;
        this.tumbling = false;
        this.group.position.copy(REST);
        this.mesh.quaternion.copy(this.target);
        const resolve = this.resolve;
        this.resolve = null;
        resolve?.();
      }
    }
  }

  private beginSettle() {
    this.settling = true;
    this.settleT = 0;
    this.settleFrom.copy(this.group.position);
    this.settleFromQuat.copy(this.mesh.quaternion);
  }

  setValue(value: number) {
    this.faceUp = value;
    this.target = restQuaternion(value);
    if (!this.tumbling) this.mesh.quaternion.copy(this.target);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** True while the die is tumbling or settling, so shadows keep updating. */
  get animating(): boolean {
    return this.tumbling || this.settling || this.body !== null;
  }
}
