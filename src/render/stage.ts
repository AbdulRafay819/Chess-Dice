import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { radialSprite } from './textures';

export type ViewMode = 'bird' | 'human' | 'sniper';

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const HUMAN_TARGET = new THREE.Vector3(0, 0.1, -0.35);
const BIRD_TARGET = new THREE.Vector3(0, 0, 0);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Distance at which the whole table stays in shot. The near edge of the board
 * is several units closer to the lens than its centre, so fitting the centre
 * plane alone lets the front rank spill off screen; the near-edge term keeps
 * the corners inside the frame. Portrait screens back the camera off rather
 * than widening the lens into a fish-eye that distorts the squares.
 */
function fitDistance(fov: number, aspect: number, elevation: number): number {
  const vTan = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const hTan = vTan * Math.max(0.38, aspect);
  const near = 4.75 * Math.cos(elevation);
  const across = 5.15 / hTan + near;
  const depth = (4.75 * Math.sin(elevation) + 2.3) / vTan + near * 0.3;
  return clamp(Math.max(across, depth) * 1.07, 10.5, 30);
}

/** Three-quarter view from the player's own side of the table. */
function humanPose(aspect: number): Pose {
  const narrow = clamp((1.35 - aspect) / 0.85, 0, 1);
  const fov = 46 + 7 * narrow;
  const elevation = 0.53 + 0.34 * narrow; // ~30° on wide screens, ~50° in portrait
  const distance = fitDistance(fov, aspect, elevation);
  return {
    position: new THREE.Vector3(
      0,
      HUMAN_TARGET.y + Math.sin(elevation) * distance,
      HUMAN_TARGET.z + Math.cos(elevation) * distance,
    ),
    target: HUMAN_TARGET.clone(),
    fov,
  };
}

function birdPose(aspect: number): Pose {
  const fov = 48;
  const distance = fitDistance(fov, aspect, Math.PI / 2);
  return {
    position: new THREE.Vector3(0, distance, 0.02),
    target: BIRD_TARGET.clone(),
    fov,
  };
}

/** Vertical gradient behind the scene, so the void has depth instead of flat black. */
function backdropTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#05070d');
  gradient.addColorStop(0.42, '#0a1020');
  gradient.addColorStop(0.7, '#141c31');
  gradient.addColorStop(0.88, '#262a45');
  gradient.addColorStop(1, '#3b2f36');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.05, 120);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;

  /** Visual slow-motion only; rules and input timing stay untouched. */
  timeScale = 1;
  reduceShake = false;
  reduceMotion = false;
  mode: ViewMode = 'human';

  private mount: HTMLElement;
  private transition: {
    from: { position: THREE.Vector3; target: THREE.Vector3 };
    to: { position: THREE.Vector3; target: THREE.Vector3 };
    t: number;
    duration: number;
  } | null = null;
  private sniperPose: Pose | null = null;
  private trauma = 0;
  private shakeTime = 0;
  /**
   * Frame-cost control. The scene is static most of the time (it is a
   * turn-based game), so the shadow map is only re-rendered on frames where
   * something moved, and the pixel ratio steps down if frames run long.
   */
  private shadowFrame = true;
  private side: 'w' | 'b' = 'w';
  private stars: THREE.Points | null = null;
  private coarsePointer = window.matchMedia?.('(pointer: coarse)').matches === true;
  private dprCap = Math.min(window.devicePixelRatio || 1, this.coarsePointer ? 1.6 : 2);
  private dpr = Math.min(this.dprCap, 2);
  private frameEma = 16.7;
  private dprCooldown = 0;
  private slowFrames = 0;
  private fastFrames = 0;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.scene.background = backdropTexture();
    this.scene.fog = new THREE.Fog(0x0a0f1a, 26, 64);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Casters only move when a piece lands or the die tumbles; re-rendering the
    // 2048² shadow map every frame was pure waste in an idle scene.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(this.renderer.domElement);

    // Start already framed for the real panel size, so the first frame is the
    // final framing instead of a dolly-in from a guessed aspect.
    const view = this.sizeOf(mount);
    this.camera.aspect = view.width / view.height;
    const start = this.orient(humanPose(this.camera.aspect));
    this.camera.position.copy(start.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(start.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.5;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 34;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.enablePan = false;
    this.controls.update();
    // A drag or a wheel always wins over a scripted camera move.
    const cancel = () => this.cancelTransition();
    this.renderer.domElement.addEventListener('pointerdown', cancel, { passive: true });
    this.renderer.domElement.addEventListener('wheel', cancel, { passive: true });

    this.setupLighting();
    this.buildBackdrop();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    pmrem.dispose();

    const size = this.sizeOf(mount);
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      this.coarsePointer ? 0.17 : 0.21,
      0.55,
      1.05,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(mount);
    window.addEventListener('resize', () => this.resize());
  }

  private setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xcddfff, 0x2a1d14, 0.32));

    const key = new THREE.DirectionalLight(0xffe6c4, 2.0);
    key.position.set(-5.5, 11, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3.2;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x6f92ff, 0.55);
    rim.position.set(7, 6, -7);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0xffb877, 0.22);
    fill.position.set(2, 3, 9);
    this.scene.add(fill);
  }

  /**
   * A starfield and a warm pool of light under the table. The board used to
   * float in a flat black void; these two cheap props give it a place.
   */
  private buildBackdrop() {
    const count = this.coarsePointer ? 320 : 620;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
      new THREE.Color(0xc3d6ff),
      new THREE.Color(0xffdcb0),
      new THREE.Color(0x93a4cb),
    ];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 24 + Math.random() * 28;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = -2 + Math.random() * 32;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      const color = palette[i % palette.length];
      const dim = 0.55 + Math.random() * 0.45;
      colors[i * 3] = color.r * dim;
      colors[i * 3 + 1] = color.g * dim;
      colors[i * 3 + 2] = color.b * dim;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.36,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        fog: false,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.stars);

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(48, 48),
      new THREE.MeshBasicMaterial({
        map: radialSprite('#3d2d18'),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -1.5;
    this.scene.add(glow);
  }

  private sizeOf(mount: HTMLElement) {
    return { width: Math.max(mount.clientWidth, 1), height: Math.max(mount.clientHeight, 1) };
  }

  resize() {
    const { width, height } = this.sizeOf(this.mount);
    this.camera.aspect = width / height;
    // Always rebuild the projection: changing only the aspect leaves the old
    // matrix in place and stretches the whole scene.
    this.camera.updateProjectionMatrix();
    this.applyFraming();
    this.refit();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  private basePose(): Pose {
    if (this.mode === 'bird') return this.orient(birdPose(this.camera.aspect));
    if (this.mode === 'sniper' && this.sniperPose) return this.sniperPose;
    return this.orient(humanPose(this.camera.aspect));
  }

  private applyFraming() {
    const fov = this.basePose().fov;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Re-fit the distance on resize while keeping the player's orbit angle. */
  private refit() {
    if (this.mode === 'sniper') return;
    const pose = this.basePose();
    if (this.transition) {
      // A resize mid-move must retarget the move, or it settles at the framing
      // that was correct for the old viewport.
      this.transition.to = { position: pose.position.clone(), target: pose.target.clone() };
      return;
    }
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() < 1e-4) offset.set(0, 6, 10);
    offset.normalize().multiplyScalar(pose.position.distanceTo(pose.target));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  private cancelTransition() {
    if (!this.transition) return;
    this.transition = null;
    if (this.mode !== 'sniper') this.controls.enabled = true;
  }

  /**
   * Which side of the table the camera sits on, so the player's own pieces are
   * nearest and the board reads from their rank. White looks up the board from
   * +Z, Black from -Z.
   */
  setSide(color: 'w' | 'b') {
    if (this.side === color) return;
    this.side = color;
    if (this.mode === 'sniper') return;
    // Snap rather than glide: a scripted move would fly the lens through the
    // board to reach the other end of the table.
    this.transition = null;
    this.applyFraming();
    const pose = this.basePose();
    this.camera.position.copy(pose.position);
    this.controls.target.copy(pose.target);
    this.camera.lookAt(pose.target);
    this.controls.enabled = true;
    this.controls.update();
  }

  private orient(pose: Pose): Pose {
    if (this.side === 'w') return pose;
    return {
      position: new THREE.Vector3(-pose.position.x, pose.position.y, -pose.position.z),
      target: new THREE.Vector3(-pose.target.x, pose.target.y, -pose.target.z),
      fov: pose.fov,
    };
  }

  add(object: THREE.Object3D) {
    this.scene.add(object);
    return object;
  }

  setView(mode: ViewMode) {
    this.mode = mode;
    this.applyFraming();
    const pose = this.basePose();
    this.beginTransition(pose, mode === 'sniper' ? 0.7 : 0.95);
    this.controls.enabled = mode !== 'sniper';
    if (mode === 'sniper' && this.sniperPose) {
      this.camera.position.copy(this.sniperPose.position);
      this.controls.target.copy(this.sniperPose.target);
      this.camera.lookAt(this.sniperPose.target);
    }
  }

  /**
   * Elevated three-quarter view framing the whole firing lane. The lens sits off
   * the line on whichever side is further from the statue, so a shot from any
   * square keeps both the shooter and the landing point in frame — and the
   * camera cannot end up inside Aurevak's crown or under the table.
   */
  setSniperView(origin: THREE.Vector3, direction: THREE.Vector3, landing?: THREE.Vector3 | null) {
    const dir = direction.clone().setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    const end = landing
      ? landing.clone().setY(origin.y)
      : origin.clone().addScaledVector(dir, 2.8);
    const span = THREE.MathUtils.clamp(origin.distanceTo(end), 1.6, 11);
    const mid = origin.clone().lerp(end, 0.5);

    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    // Two statue anchors: the figure is mirrored to the far corner per side.
    const statue = new THREE.Vector3(-3.9, 0, -4.9);
    const anchors = [statue, statue.clone().negate()];
    const clearance = (point: THREE.Vector3) =>
      Math.min(point.distanceTo(anchors[0]), point.distanceTo(anchors[1]));

    const offset = 3.6 + span * 0.34;
    const first = mid.clone().addScaledVector(across, offset);
    const second = mid.clone().addScaledVector(across, -offset);
    const position = clearance(first) >= clearance(second) ? first : second;

    // Belt and braces: push the lens out of the monument if it landed inside it.
    for (const anchor of anchors) {
      const away = position.clone().sub(anchor).setY(0);
      const distance = away.length();
      if (distance < 2.8) {
        if (distance < 0.001) away.copy(across);
        position.addScaledVector(away.normalize(), 2.8 - distance + 0.6);
      }
    }

    position.y = 3.2 + span * 0.26;
    const target = mid.clone();
    target.y = origin.y + 0.25;
    this.sniperPose = { position, target, fov: 52 };
    this.mode = 'sniper';
    this.controls.enabled = false;
    this.applyFraming();
    this.beginTransition(this.sniperPose, 0.6);
  }

  private beginTransition(to: Pose, duration: number) {
    this.transition = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to: { position: to.position.clone(), target: to.target.clone() },
      t: 0,
      duration: this.reduceMotion ? Math.min(duration, 0.25) : duration,
    };
  }

  addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  hitStop(durationMs: number, slow = 0.28) {
    this.timeScale = slow;
    window.setTimeout(() => {
      if (this.timeScale === slow) this.timeScale = 1;
    }, durationMs);
  }

  update(dt: number, realDt: number) {
    if (this.transition) {
      this.transition.t = Math.min(1, this.transition.t + realDt / this.transition.duration);
      const k = easeInOut(this.transition.t);
      this.camera.position.lerpVectors(this.transition.from.position, this.transition.to.position, k);
      this.controls.target.lerpVectors(this.transition.from.target, this.transition.to.target, k);
      if (this.transition.t >= 1) {
        this.transition = null;
        if (this.mode !== 'sniper') this.controls.enabled = true;
      }
    } else if (this.mode === 'sniper' && this.sniperPose) {
      this.camera.lookAt(this.sniperPose.target);
    } else {
      this.controls.update();
    }

    // Trauma-based shake: squared falloff, decayed in real time so hit-stop
    // never freezes the camera off-centre.
    this.trauma = Math.max(0, this.trauma - realDt * 1.15);
    this.shakeTime += realDt * 26;
    if (this.trauma > 0 && !this.reduceShake) {
      const intensity = this.trauma * this.trauma;
      const amplitude = 0.085 * intensity;
      this.camera.position.x += Math.sin(this.shakeTime * 1.7) * amplitude;
      this.camera.position.y += Math.sin(this.shakeTime * 2.3 + 1.1) * amplitude * 0.7;
      this.camera.rotation.z += Math.sin(this.shakeTime * 1.1) * 0.006 * intensity;
    }

    if (this.stars) this.stars.rotation.y += realDt * 0.004;

    this.tuneResolution(realDt);
    void dt;
  }

  /** Ask for one shadow-map pass, for frames where something moved. */
  invalidateShadows() {
    this.shadowFrame = true;
  }

  /**
   * Adaptive resolution: an integrated GPU that misses 60 fps gets a lower
   * render scale instead of stutter, and climbs back once it has headroom.
   * Hysteresis plus a cooldown keeps it from oscillating.
   */
  private tuneResolution(realDt: number) {
    const ms = realDt * 1000;
    this.frameEma += (ms - this.frameEma) * 0.05;
    this.dprCooldown = Math.max(0, this.dprCooldown - realDt);
    if (this.dprCooldown > 0) return;

    if (this.frameEma > 21 && this.dpr > 1) {
      if (++this.slowFrames > 90) {
        this.dpr = Math.max(1, Math.round((this.dpr - 0.2) * 100) / 100);
        this.renderer.setPixelRatio(this.dpr);
        this.dprCooldown = 2.5;
        this.slowFrames = 0;
        this.fastFrames = 0;
        this.resize();
      }
    } else if (this.frameEma < 11 && this.dpr < this.dprCap) {
      if (++this.fastFrames > 180) {
        this.dpr = Math.min(this.dprCap, Math.round((this.dpr + 0.2) * 100) / 100);
        this.renderer.setPixelRatio(this.dpr);
        this.dprCooldown = 3;
        this.slowFrames = 0;
        this.fastFrames = 0;
        this.resize();
      }
    } else {
      this.slowFrames = 0;
      this.fastFrames = 0;
    }
  }

  get frameTime() {
    return this.frameEma;
  }

  get renderScale() {
    return this.dpr;
  }

  render() {
    this.renderer.shadowMap.needsUpdate = this.shadowFrame;
    this.shadowFrame = false;
    this.composer.render();
  }

  /** Screen point → point on the playing surface. */
  projectToBoard(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.085);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  screenPoint(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  raycast(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.screenPoint(clientX, clientY), this.camera);
    return raycaster.intersectObjects(objects, true);
  }
}
