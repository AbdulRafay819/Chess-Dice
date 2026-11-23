import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type ViewMode = 'bird' | 'human' | 'sniper';

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const HUMAN: Pose = {
  position: new THREE.Vector3(0, 6.3, 10.4),
  target: new THREE.Vector3(0, 0.1, 0.2),
};

const BIRD: Pose = {
  position: new THREE.Vector3(0, 12.8, 0.02),
  target: new THREE.Vector3(0, 0, 0),
};

/**
 * Portrait and narrow panels need a steeper look: the board is width-limited, so
 * raising the camera is the only way to spend the tall viewport on it.
 */
function narrowHumanPose(aspect: number): Pose {
  const t = Math.min(1, Math.max(0, (1.2 - aspect) / 0.7));
  if (t <= 0) return HUMAN;
  const elevation = 0.55 + 0.4 * t; // 31° → 54°
  const distance = 12.2 + 0.6 * t;
  return {
    position: new THREE.Vector3(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance),
    target: new THREE.Vector3(0, 0.1, 0.35),
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 120);
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
  private transition: { from: Pose; to: Pose; t: number; duration: number } | null = null;
  private sniperPose: Pose | null = null;
  private trauma = 0;
  private shakeTime = 0;
  /**
   * Frame-cost control. The scene is static most of the time (it is a
   * turn-based game), so the shadow map is only re-rendered on frames where
   * something moved, and the pixel ratio steps down if frames run long.
   */
  private shadowFrame = true;
  private dprCap = Math.min(window.devicePixelRatio || 1, 2);
  private dpr = Math.min(this.dprCap, 2);
  private frameEma = 16.7;
  private dprCooldown = 0;
  private slowFrames = 0;
  private fastFrames = 0;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.scene.background = new THREE.Color(0x080b12);
    this.scene.fog = new THREE.Fog(0x080b12, 22, 42);

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

    this.camera.position.copy(HUMAN.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(HUMAN.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 20;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.enablePan = false;
    this.controls.update();

    this.setupLighting();

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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.2, 0.5, 1.0);
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

  private sizeOf(mount: HTMLElement) {
    return { width: Math.max(mount.clientWidth, 1), height: Math.max(mount.clientHeight, 1) };
  }

  resize() {
    const { width, height } = this.sizeOf(this.mount);
    this.camera.aspect = width / height;
    this.applyFraming();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  /**
   * Keep the whole board in shot. A portrait or narrow panel has a small
   * horizontal FOV, so the lens widens until both the board's width and its
   * depth fit; wide screens keep the original 42° look.
   */
  private basePose(): Pose {
    if (this.mode === 'bird') return BIRD;
    if (this.mode === 'sniper' && this.sniperPose) return this.sniperPose;
    return narrowHumanPose(this.camera.aspect);
  }

  private applyFraming() {
    const pose = this.basePose();
    const distance = Math.max(4, pose.position.distanceTo(pose.target));
    const aspect = Math.max(0.35, this.camera.aspect);
    const horizontalNeed = 2 * Math.atan(5.6 / distance);
    const verticalNeed = Math.max(
      2 * Math.atan(4.8 / distance),
      2 * Math.atan(Math.tan(horizontalNeed / 2) / aspect),
    );
    this.camera.fov = THREE.MathUtils.clamp((verticalNeed * 180) / Math.PI, 38, 84);
    this.camera.updateProjectionMatrix();
  }

  add(object: THREE.Object3D) {
    this.scene.add(object);
    return object;
  }

  setView(mode: ViewMode) {
    this.mode = mode;
    const pose = mode === 'bird'
      ? BIRD
      : mode === 'sniper'
        ? this.sniperPose ?? narrowHumanPose(this.camera.aspect)
        : narrowHumanPose(this.camera.aspect);
    this.beginTransition(pose, mode === 'sniper' ? 0.7 : 0.95);
    this.applyFraming();
    this.controls.enabled = mode !== 'sniper';
    if (mode === 'sniper' && this.sniperPose) {
      this.camera.position.copy(this.sniperPose.position);
      this.controls.target.copy(this.sniperPose.target);
      this.camera.lookAt(this.sniperPose.target);
    }
  }

  /**
   * Elevated three-quarter view down the firing lane. Sitting behind the
   * shooter hid the shot behind its own piece, so the camera lifts above the
   * board and steps to the side of the line instead.
   */
  setSniperView(origin: THREE.Vector3, direction: THREE.Vector3) {
    const dir = direction.clone().setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const position = origin
      .clone()
      .addScaledVector(dir, -2.4)
      .addScaledVector(side, 3.6)
      .add(new THREE.Vector3(0, 3.4, 0));
    const target = origin
      .clone()
      .addScaledVector(dir, 2.6)
      .add(new THREE.Vector3(0, 0.2, 0));
    this.sniperPose = { position, target };
    this.mode = 'sniper';
    this.controls.enabled = false;
    this.applyFraming();
    this.beginTransition(this.sniperPose, 0.55);
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
