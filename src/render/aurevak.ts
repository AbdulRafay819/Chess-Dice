import * as THREE from 'three';
import { radialSprite } from './textures';

const GOLD = 0xd9b46b;
const EMBER = 0xffb45a;

/**
 * AUREVAK — THE FIRST TO RULE. THE LAST TO FALL.
 *
 * A standing figure rather than a monument: tall and narrow, black layered
 * robes with crimson lining, a featureless gold-and-black mask under an
 * asymmetrical crown of blades. He stands at the far side of the table, head
 * following the die, and casts it from an open palm without touching it.
 *
 * Everything is procedural geometry: no model download, no animation mixer.
 * The rig is a handful of nested groups (head, casting shoulder, wrist), which
 * is all the ritual needs.
 */
export class Aurevak {
  readonly group = new THREE.Group();
  readonly height = 2.65;

  /** Anchor in world XZ, mirrored to the far side for the player's colour. */
  private static readonly ANCHOR = new THREE.Vector3(-3.9, 0, -4.9);

  private body = new THREE.Group();
  private headPivot = new THREE.Group();
  private castArm = new THREE.Group();
  private hand = new THREE.Group();
  private handAnchor = new THREE.Object3D();

  private shoulderPlate = new THREE.Mesh();
  private artifact = new THREE.Group();
  private artifactCore!: THREE.Mesh;
  private artifactMaterial!: THREE.MeshStandardMaterial;
  private artifactLight!: THREE.PointLight;
  private orbit!: THREE.Mesh;
  private shards: { mesh: THREE.Mesh; phase: number }[] = [];

  private ritual = 0;
  private headYaw = 0;
  private headPitch = 0;
  private focus = new THREE.Vector3(0, 0.1, 0);
  private tmp = new THREE.Vector3();

  constructor() {
    const obsidian = new THREE.MeshStandardMaterial({
      color: 0x0d0e13,
      roughness: 0.42,
      metalness: 0.55,
      envMapIntensity: 1.05,
    });
    const cloth = new THREE.MeshStandardMaterial({
      color: 0x121219,
      roughness: 0.86,
      metalness: 0.12,
      envMapIntensity: 0.9,
      side: THREE.DoubleSide,
    });
    const lining = new THREE.MeshStandardMaterial({
      color: 0x5c1220,
      roughness: 0.7,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    const gold = new THREE.MeshStandardMaterial({
      color: GOLD,
      roughness: 0.26,
      metalness: 1,
      envMapIntensity: 1.45,
    });
    const maskFace = new THREE.MeshStandardMaterial({
      color: 0x15110b,
      roughness: 0.3,
      metalness: 0.92,
      envMapIntensity: 1.3,
    });

    this.buildPlinth(obsidian, gold);
    this.buildRobes(cloth, lining, gold);
    this.buildTorso(obsidian, cloth, gold);
    this.buildArms(cloth, obsidian, gold, lining);
    this.buildHead(obsidian, cloth, gold, maskFace);
    this.buildArtifact(gold, obsidian);

    this.group.add(this.body);
    this.group.scale.setScalar(1.2);
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    for (const shard of this.shards) shard.mesh.castShadow = false;
    this.artifactCore.castShadow = false;

    this.setSide('w');
  }

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */

  /**
   * Pleats are baked into the lathe by scaling each vertex radially with a
   * cosine of its angle, so the cloth reads as folds instead of a smooth cone.
   */
  private pleated(
    points: [number, number][],
    segments: number,
    pleats: number,
    depth: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const geometry = new THREE.LatheGeometry(
      points.map(([radius, y]) => new THREE.Vector2(Math.max(radius, 0.0001), y)),
      segments,
    );
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const theta = Math.atan2(z, x);
      const k = 1 + depth * Math.cos(theta * pleats);
      position.setX(i, x * k);
      position.setZ(i, z * k);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
  }

  /** Curved trim that hugs the robe's slope: a thin slice of a cone. */
  private trim(
    topRadius: number,
    bottomRadius: number,
    height: number,
    y: number,
    theta: number,
    width: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const geometry = new THREE.CylinderGeometry(
      topRadius,
      bottomRadius,
      height,
      10,
      1,
      true,
      theta - width / 2,
      width,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    return mesh;
  }

  private buildPlinth(obsidian: THREE.MeshStandardMaterial, gold: THREE.MeshStandardMaterial) {
    // A plinth rising out of the dark, so he is standing on something rather
    // than floating beside the table.
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 0.66, 1.9, 8), obsidian);
    column.position.y = -0.85;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 0.9, 0.14, 8), obsidian);
    cap.position.y = 0.04;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.016, 5, 8), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.10;
    const etch = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.012, 4, 8), gold);
    etch.rotation.x = Math.PI / 2;
    etch.position.y = 0.11;
    for (const mesh of [column, cap, rim, etch]) this.group.add(mesh);
  }

  private buildRobes(
    cloth: THREE.MeshStandardMaterial,
    lining: THREE.MeshStandardMaterial,
    gold: THREE.MeshStandardMaterial,
  ) {
    this.body.position.y = 0.11;

    // Crimson lining first: it sits under the hem and peeks out at floor level.
    const underRobe = this.pleated(
      [
        [0.675, 0.0],
        [0.69, 0.1],
        [0.62, 0.26],
      ],
      40,
      7,
      0.05,
      lining,
    );
    this.body.add(underRobe);

    const robe = this.pleated(
      [
        [0.66, 0.08],
        [0.68, 0.16],
        [0.61, 0.36],
        [0.53, 0.7],
        [0.44, 1.0],
        [0.36, 1.24],
        [0.31, 1.4],
        [0.33, 1.52],
      ],
      48,
      7,
      0.09,
      cloth,
    );
    this.body.add(robe);

    // Second, shorter layer — the robe is layered, not a single cone.
    const overRobe = this.pleated(
      [
        [0.58, 0.5],
        [0.52, 0.72],
        [0.45, 0.94],
        [0.37, 1.14],
        [0.31, 1.3],
      ],
      56,
      9,
      0.03,
      cloth,
    );
    this.body.add(overRobe);

    // Aged gold trim: hem bands and two strips down the front panels.
    for (const [radius, y, tube] of [
      [0.685, 0.17, 0.014],
      [0.325, 1.32, 0.01],
    ] as const) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 5, 44), gold);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      this.body.add(band);
    }

    // Crimson opening between two gold-trimmed front panels.
    this.body.add(this.trim(0.4, 0.695, 1.0, 0.66, 0, 0.12, lining));
    this.body.add(this.trim(0.41, 0.705, 1.02, 0.66, 0.21, 0.05, gold));
    this.body.add(this.trim(0.41, 0.705, 1.02, 0.66, -0.21, 0.05, gold));

    // Cape: a partial revolve behind the shoulders, gapped at the front.
    const capeGeometry = new THREE.LatheGeometry(
      [
        [0.96, 0.06],
        [0.9, 0.48],
        [0.76, 0.94],
        [0.6, 1.32],
        [0.46, 1.62],
        [0.35, 1.76],
      ].map(([radius, y]) => new THREE.Vector2(radius, y)),
      48,
      Math.PI * 0.58,
      Math.PI * 0.84,
    );
    const capePositions = capeGeometry.attributes.position;
    for (let i = 0; i < capePositions.count; i++) {
      const x = capePositions.getX(i);
      const z = capePositions.getZ(i);
      const theta = Math.atan2(z, x);
      const k = 1 + 0.045 * Math.cos(theta * 7);
      capePositions.setX(i, x * k);
      capePositions.setZ(i, z * k);
    }
    capeGeometry.computeVertexNormals();
    const capeMesh = new THREE.Mesh(capeGeometry, cloth);
    this.body.add(capeMesh);

    const capeHemGeometry = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.97, 0.02),
        new THREE.Vector2(0.965, 0.15),
      ],
      40,
      Math.PI * 0.58,
      Math.PI * 0.84,
    );
    const capeHem = new THREE.Mesh(capeHemGeometry, gold);
    this.body.add(capeHem);
  }

  private buildTorso(
    obsidian: THREE.MeshStandardMaterial,
    cloth: THREE.MeshStandardMaterial,
    gold: THREE.MeshStandardMaterial,
  ) {
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.33, 0.38, 16), obsidian);
    chest.position.y = 1.6;
    this.body.add(chest);

    // Three collar tiers, each smaller than the last, with gold rims.
    for (const [top, bottom, height, y] of [
      [0.34, 0.44, 0.18, 1.8],
      [0.27, 0.36, 0.14, 1.91],
      [0.22, 0.3, 0.1, 2.0],
    ] as const) {
      const tier = new THREE.Mesh(
        new THREE.CylinderGeometry(top, bottom, height, 14, 1, true),
        cloth,
      );
      tier.position.y = y;
      this.body.add(tier);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(top + 0.005, 0.009, 4, 20), gold);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y + height / 2;
      this.body.add(rim);
    }

    // Chest medallion carrying the crest: three prongs and a vertical blade.
    const medallion = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.018, 18), gold);
    medallion.rotation.x = Math.PI / 2;
    medallion.position.set(0, 1.5, 0.32);
    this.body.add(medallion);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.2, 0.012), gold);
    blade.position.set(0, 1.5, 0.335);
    this.body.add(blade);
    for (const [x, y, h] of [
      [-0.04, 1.52, 0.07],
      [0.04, 1.52, 0.07],
      [0, 1.5, 0.09],
    ] as const) {
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, 0.01), gold);
      prong.position.set(x, y, 0.33);
      this.body.add(prong);
    }

    // Chain from each shoulder down to the medallion.
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(side * 0.26, 1.74, 0.24);
      const to = new THREE.Vector3(side * 0.02, 1.56, 0.32);
      this.body.add(this.limb(from, to, 0.008, 0.008, gold));
    }
  }

  private buildArms(
    cloth: THREE.MeshStandardMaterial,
    obsidian: THREE.MeshStandardMaterial,
    gold: THREE.MeshStandardMaterial,
    lining: THREE.MeshStandardMaterial,
  ) {
    // Resting arm: hangs from the left shoulder, hand closed at the hip.
    const s2 = new THREE.Vector3(-0.42, 1.68, 0.0);
    const e2 = new THREE.Vector3(-0.6, 1.24, 0.1);
    const w2 = new THREE.Vector3(-0.63, 0.98, 0.26);
    this.body.add(this.limb(s2, e2, 0.095, 0.078, cloth));
    this.body.add(this.limb(e2, w2, 0.076, 0.06, cloth));
    const cuff2 = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 16), gold);
    cuff2.position.copy(w2);
    this.body.add(cuff2);
    const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.09), obsidian);
    hand2.position.copy(w2).add(new THREE.Vector3(0, -0.09, 0.02));
    this.body.add(hand2);

    // Casting arm: bent, palm up, held just above the table's far edge.
    // The palm is held out over the table, not out to the side, so the cast
    // really leaves his hand above the board's far edge.
    const shoulder = new THREE.Vector3(0.5, 1.66, 0.0);
    const elbow = new THREE.Vector3(0.68, 1.3, 0.5);
    const wrist = new THREE.Vector3(0.58, 1.52, 0.98);
    const palm = new THREE.Vector3(0.56, 1.6, 1.1);

    this.castArm.position.copy(shoulder);
    this.body.add(this.castArm);
    const rel = (point: THREE.Vector3) => point.clone().sub(shoulder);

    this.castArm.add(this.limb(new THREE.Vector3(), rel(elbow), 0.098, 0.08, cloth));
    this.castArm.add(this.limb(rel(elbow), rel(wrist), 0.078, 0.06, cloth));

    const pauldron = new THREE.Mesh(
      new THREE.SphereGeometry(0.29, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
      obsidian,
    );
    pauldron.scale.set(1.18, 0.44, 1.22);
    pauldron.rotation.z = -0.4;
    pauldron.position.y = 0.06;
    this.castArm.add(pauldron);
    const pauldronRim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.016, 5, 26), gold);
    pauldronRim.rotation.x = Math.PI / 2;
    pauldronRim.position.y = -0.03;
    pauldronRim.rotation.z = -0.4;
    pauldronRim.scale.set(1.18, 1.22, 1);
    this.castArm.add(pauldronRim);

    const otherPauldron = new THREE.Mesh(
      new THREE.SphereGeometry(0.29, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
      obsidian,
    );
    otherPauldron.scale.set(1.18, 0.44, 1.22);
    otherPauldron.rotation.z = 0.4;
    otherPauldron.position.set(-0.46, 1.73, 0.0);
    this.body.add(otherPauldron);
    const otherRim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.016, 5, 26), gold);
    otherRim.rotation.x = Math.PI / 2;
    otherRim.rotation.z = 0.4;
    otherRim.position.set(-0.46, 1.71, 0.0);
    otherRim.scale.set(1.18, 1.22, 1);
    this.body.add(otherRim);

    // Hand: open palm, fingers curled slightly, crimson cuff behind it.
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.1, 12), lining);
    cuff.position.copy(rel(wrist));
    cuff.quaternion.copy(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        rel(wrist).sub(rel(elbow)).normalize(),
      ),
    );
    this.castArm.add(cuff);
    const wristRing = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.012, 4, 18), gold);
    wristRing.position.copy(rel(wrist));
    wristRing.rotation.x = Math.PI / 2;
    this.castArm.add(wristRing);

    this.hand.position.copy(rel(palm));
    this.castArm.add(this.hand);

    const palmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.042, 0.19), obsidian);
    this.hand.add(palmMesh);
    const fingerGeometry = new THREE.CapsuleGeometry(0.016, 0.085, 4, 8);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(fingerGeometry, obsidian);
      finger.position.set(-0.048 + i * 0.032, 0.026, 0.075);
      finger.rotation.x = -0.55;
      this.hand.add(finger);
    }
    const thumb = new THREE.Mesh(fingerGeometry, obsidian);
    thumb.position.set(-0.072, 0.02, 0.02);
    thumb.rotation.set(-0.3, 0, 0.9);
    this.hand.add(thumb);

    this.handAnchor.position.set(0, 0.11, 0.16);
    this.hand.add(this.handAnchor);

    this.shoulderPlate = pauldron;
  }

  private buildHead(
    obsidian: THREE.MeshStandardMaterial,
    cloth: THREE.MeshStandardMaterial,
    gold: THREE.MeshStandardMaterial,
    maskFace: THREE.MeshStandardMaterial,
  ) {
    this.headPivot.position.set(0, 1.9, 0.02);
    this.headPivot.rotation.order = 'YXZ';
    this.headPivot.scale.setScalar(1.18);
    this.body.add(this.headPivot);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.16, 10), obsidian);
    neck.position.y = -0.04;
    this.headPivot.add(neck);

    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.215, 20, 16), cloth);
    hood.scale.set(1, 1.06, 0.92);
    hood.position.set(0, 0.17, -0.02);
    this.headPivot.add(hood);

    // Cowl behind the head, so the silhouette has a peak at the back.
    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.42, 9), cloth);
    cowl.position.set(0, 0.2, -0.1);
    cowl.rotation.x = -0.3;
    this.headPivot.add(cowl);

    // Mask: gold backing plate, dark inset, single vertical ridge.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.105, 0.075);
    shape.lineTo(0.125, 0.16);
    shape.lineTo(0.115, 0.245);
    shape.lineTo(0.06, 0.3);
    shape.lineTo(-0.06, 0.3);
    shape.lineTo(-0.115, 0.245);
    shape.lineTo(-0.125, 0.16);
    shape.lineTo(-0.105, 0.075);
    shape.closePath();

    const goldPlate = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.05,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.012,
        bevelSegments: 2,
        curveSegments: 6,
      }),
      gold,
    );
    goldPlate.position.set(0, 0.015, 0.15);
    goldPlate.scale.set(1.34, 1.26, 1);
    this.headPivot.add(goldPlate);

    const inset = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.04,
        bevelEnabled: true,
        bevelThickness: 0.008,
        bevelSize: 0.008,
        bevelSegments: 2,
        curveSegments: 6,
      }),
      maskFace,
    );
    inset.scale.set(0.62, 0.68, 1);
    inset.position.set(0, 0.05, 0.19);
    this.headPivot.add(inset);

    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.27, 0.024), gold);
    ridge.position.set(0, 0.16, 0.245);
    this.headPivot.add(ridge);
    const chin = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), gold);
    chin.rotation.x = Math.PI;
    chin.position.set(0, 0.02, 0.19);
    this.headPivot.add(chin);

    // Crown: asymmetrical blades of uneven height on a gold ring.
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.07, 12, 1, true), gold);
    ring.position.y = 0.3;
    this.headPivot.add(ring);

    // Blade heights are deliberately uneven, and the outward lean is small, so
    // the crown looks like broken swords pushed upright, not a peacock fan.
    const heights = [0.82, 0.46, 0.64, 0.38, 0.56, 0.42];
    heights.forEach((height, index) => {
      const angle = (index / heights.length) * Math.PI * 2 + 0.16;
      const blade = new THREE.Mesh(this.bladeGeometry(height), gold);
      blade.position.set(Math.sin(angle) * 0.165, 0.31, Math.cos(angle) * 0.165);
      blade.rotation.y = angle;
      blade.rotation.x = 0.02 + (index % 2) * 0.03;
      this.headPivot.add(blade);
    });
  }

  /** Tapered, slightly curved crown blade, shaped like a broken sword. */
  private bladeGeometry(height: number): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.052, 0);
    shape.lineTo(0.052, 0);
    shape.lineTo(0.044, height * 0.55);
    shape.quadraticCurveTo(0.036, height * 0.82, 0.01, height);
    shape.quadraticCurveTo(-0.016, height * 0.8, -0.036, height * 0.52);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.032,
      bevelEnabled: true,
      bevelThickness: 0.005,
      bevelSize: 0.005,
      bevelSegments: 1,
      curveSegments: 4,
    });
  }

  private buildArtifact(gold: THREE.MeshStandardMaterial, obsidian: THREE.MeshStandardMaterial) {
    this.artifact.position.set(0.56, 1.8, 1.16);
    this.body.add(this.artifact);

    // The artifact is the same ivory die the game uses, held in suspension and
    // lit from within — so the object he casts is recognisably that die.
    this.artifactMaterial = new THREE.MeshStandardMaterial({
      color: 0xefe4cf,
      emissive: new THREE.Color(EMBER),
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.12,
      transparent: true,
      opacity: 1,
    });
    this.artifactCore = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), this.artifactMaterial);
    this.artifactCore.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.141, 0.141, 0.141)),
        new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 }),
      ),
    );
    this.artifact.add(this.artifactCore);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialSprite('#ffb45a'),
        color: 0xffc477,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.scale.setScalar(0.62);
    this.artifact.add(halo);

    // A thin orbit ring, so the artifact reads as a die being held in suspension.
    this.orbit = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.005, 4, 32), gold);
    this.orbit.rotation.x = 1.1;
    this.artifact.add(this.orbit);

    const shardGeometry = new THREE.OctahedronGeometry(0.024, 0);
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(shardGeometry, gold);
      shard.scale.set(1, 1.8, 1);
      this.artifact.add(shard);
      this.shards.push({ mesh: shard, phase: (i / 3) * Math.PI * 2 });
    }

    this.artifactLight = new THREE.PointLight(EMBER, 0.7, 2.4, 2);
    this.artifact.add(this.artifactLight);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 20),
      new THREE.MeshBasicMaterial({ color: 0x05060a, transparent: true, opacity: 0.55 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.055;
    shadow.castShadow = false;
    this.group.add(shadow);
    void obsidian;
  }

  private limb(
    from: THREE.Vector3,
    to: THREE.Vector3,
    startRadius: number,
    endRadius: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const direction = to.clone().sub(from);
    const length = direction.length();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(startRadius, endRadius, length, 10, 1),
      material,
    );
    mesh.position.copy(from).addScaledVector(direction, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  /* ------------------------------------------------------------------ *
   * Behaviour
   * ------------------------------------------------------------------ */

  /** Stand on the far side of the table, facing its centre. */
  setSide(color: 'w' | 'b') {
    const sign = color === 'w' ? 1 : -1;
    this.group.position.set(Aurevak.ANCHOR.x * sign, 0, Aurevak.ANCHOR.z * sign);
    this.group.rotation.y = Math.atan2(-this.group.position.x, -this.group.position.z);
  }

  /** Point he watches: called every frame with the die's position. */
  setFocus(point: THREE.Vector3) {
    this.focus.copy(point);
  }

  /** Kick off the cast: the palm lifts, the artifact flares and vanishes. */
  invoke() {
    this.ritual = 1;
  }

  /** World point the die is released from — just ahead of the open palm. */
  handPoint(): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.handAnchor.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number, time: number) {
    this.ritual = Math.max(0, this.ritual - dt * 0.5);
    const flare = this.ritual * this.ritual;

    // Breathing and a slow drift: alive, but never fidgeting.
    const breathe = Math.sin(time * 1.05) * 0.006;
    this.body.scale.set(1, 1 + breathe, 1 + breathe * 0.5);
    this.body.rotation.z = Math.sin(time * 0.55) * 0.006;
    this.body.rotation.x = -flare * 0.04;

    // Head tracking: he follows the die wherever it tumbles.
    this.tmp.copy(this.focus);
    this.group.worldToLocal(this.tmp);
    const dx = this.tmp.x;
    const dz = this.tmp.z;
    const dy = this.tmp.y - (1.9 + 0.11);
    const flat = Math.max(0.001, Math.hypot(dx, dz));
    const targetYaw = THREE.MathUtils.clamp(Math.atan2(dx, dz), -0.55, 0.55);
    const targetPitch = THREE.MathUtils.clamp(Math.atan2(-dy, flat), -0.25, 0.42);
    const ease = Math.min(1, dt * 3.4);
    this.headYaw += (targetYaw - this.headYaw) * ease;
    this.headPitch += (targetPitch - this.headPitch) * ease;
    this.headPivot.rotation.y = this.headYaw;
    this.headPivot.rotation.x = this.headPitch * 0.8;
    this.body.rotation.y = this.headYaw * 0.2;

    // Casting gesture on the ritual.
    this.castArm.rotation.x = -flare * 0.2;
    this.castArm.rotation.z = flare * 0.08;
    this.hand.rotation.x = -flare * 0.45;
    this.shoulderPlate.scale.y = 0.72 + flare * 0.03;

    // The artifact is the die he manipulates: it leaves the palm as the real
    // die is cast, and returns once the ritual settles.
    const presence = this.ritual > 0.45 ? (1 - this.ritual) / 0.55 : this.ritual / 0.45;
    const visible = Math.max(0, presence);
    this.artifact.scale.setScalar(0.25 + visible * 0.75);
    this.artifactMaterial.opacity = visible;
    this.artifact.position.y = 1.8 + Math.sin(time * 1.5) * 0.02 + flare * 0.1;
    this.artifact.rotation.y = time * 0.8;
    this.artifactCore.rotation.x = time * 1.1;
    this.artifactCore.rotation.z = time * 0.7;
    this.orbit.rotation.z = time * 0.9;
    this.orbit.rotation.y = time * -0.6;
    this.artifactMaterial.emissiveIntensity = 0.3 + flare * 1.8;

    for (const shard of this.shards) {
      const angle = time * 1.1 + shard.phase + flare * 3;
      const radius = 0.1 + visible * 0.03;
      shard.mesh.position.set(
        Math.cos(angle) * radius,
        Math.sin(time * 1.4 + shard.phase) * 0.03,
        Math.sin(angle) * radius,
      );
      shard.mesh.rotation.y = angle * 2;
    }

    this.artifactLight.intensity = 0.5 + flare * 2.6;
  }
}
