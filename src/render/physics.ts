import * as THREE from 'three';

/**
 * Rapier is used only for the visual layer: the die's tumble and a struck
 * piece's knock-down. It never decides an outcome — the shared rules module
 * does that on the server, and the animation plays from its result.
 */

type RapierModule = typeof import('@dimforge/rapier3d-compat');
type World = InstanceType<RapierModule['World']>;
type RigidBody = ReturnType<World['createRigidBody']>;

export class Physics {
  private rapier: RapierModule | null = null;
  private world: World | null = null;
  ready = false;

  async init(): Promise<void> {
    try {
      const imported = (await import('@dimforge/rapier3d-compat')) as unknown as {
        default?: RapierModule;
      } & RapierModule;
      const RAPIER = (imported.default ?? imported) as RapierModule;
      await RAPIER.init();
      this.rapier = RAPIER;
      this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      this.buildTable();
      this.ready = true;
    } catch (error) {
      console.warn('Rapier unavailable, using tweened effects only', error);
      this.ready = false;
    }
  }

  private buildTable() {
    if (!this.world || !this.rapier) return;
    const { world, rapier } = this;
    // Playing surface.
    const floor = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(0, -0.02, 0),
    );
    world.createCollider(
      rapier.ColliderDesc.cuboid(4.6, 0.1, 4.6).setFriction(0.9).setRestitution(0.2),
      floor,
    );
    // Frame rails keep debris and the die on the table.
    const rails: [number, number, number, number][] = [
      [0, -4.62, 4.7, 0.16],
      [0, 4.62, 4.7, 0.16],
      [-4.62, 0, 0.16, 4.7],
      [4.62, 0, 0.16, 4.7],
    ];
    for (const [x, z, hx, hz] of rails) {
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(x, -0.06, z),
      );
      world.createCollider(
        rapier.ColliderDesc.cuboid(hx, 0.22, hz).setRestitution(0.4).setFriction(0.7),
        body,
      );
    }
  }

  step(dt: number) {
    if (!this.world) return;
    void dt;
    this.world.step();
  }

  spawnDie(position: THREE.Vector3, impulse: THREE.Vector3): RigidBody | null {
    if (!this.world || !this.rapier) return null;
    const { world, rapier } = this;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.15)
        .setAngularDamping(0.35)
        .setCcdEnabled(true),
    );
    world.createCollider(
      rapier.ColliderDesc.cuboid(0.31, 0.31, 0.31)
        .setFriction(0.85)
        .setRestitution(0.32)
        .setDensity(1.1),
      body,
    );
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    body.applyTorqueImpulse(
      {
        x: (Math.random() - 0.5) * 0.9,
        y: (Math.random() - 0.5) * 0.9,
        z: (Math.random() - 0.5) * 0.9,
      },
      true,
    );
    return body;
  }

  spawnDebris(position: THREE.Vector3, impulse: THREE.Vector3): RigidBody | null {
    if (!this.world || !this.rapier) return null;
    const { world, rapier } = this;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y + 0.3, position.z)
        .setLinearDamping(0.2)
        .setAngularDamping(0.25),
    );
    world.createCollider(
      rapier.ColliderDesc.cuboid(0.2, 0.26, 0.14)
        .setFriction(0.7)
        .setRestitution(0.28)
        .setDensity(0.9),
      body,
    );
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    body.applyTorqueImpulse(
      {
        x: (Math.random() - 0.5) * 0.35,
        y: (Math.random() - 0.5) * 0.35,
        z: (Math.random() - 0.5) * 0.35,
      },
      true,
    );
    return body;
  }

  read(body: RigidBody): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    const t = body.translation();
    const q = body.rotation();
    return {
      position: new THREE.Vector3(t.x, t.y, t.z),
      quaternion: new THREE.Quaternion(q.x, q.y, q.z, q.w),
    };
  }

  remove(body: RigidBody | null) {
    if (!body || !this.world) return;
    try {
      this.world.removeRigidBody(body);
    } catch {
      /* already gone */
    }
  }

  dispose() {
    this.world?.free();
    this.world = null;
    this.ready = false;
  }
}
