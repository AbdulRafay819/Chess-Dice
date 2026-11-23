import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Color, PieceType } from '../shared/types';

const TYPE_NAME: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const COLOR_NAME: Record<Color, string> = { w: 'white', b: 'black' };

/**
 * Optional real models. Drop CC0 GLBs into `public/assets/pieces/` named
 * `white-king.glb`, `black-pawn.glb`, … and they replace the procedural set.
 * Missing files are expected and simply fall back.
 */
export async function loadPieceModels(): Promise<Map<string, THREE.Object3D>> {
  const loader = new GLTFLoader();
  const models = new Map<string, THREE.Object3D>();
  const jobs: Promise<void>[] = [];

  (Object.keys(TYPE_NAME) as PieceType[]).forEach((type) => {
    (Object.keys(COLOR_NAME) as Color[]).forEach((color) => {
      const key = `${color}:${type}`;
      const url = `/assets/pieces/${COLOR_NAME[color]}-${TYPE_NAME[type]}.glb`;
      jobs.push(
        loader
          .loadAsync(url)
          .then((gltf) => {
            const root = gltf.scene;
            const bounds = new THREE.Box3().setFromObject(root);
            const size = bounds.getSize(new THREE.Vector3());
            // Normalise every model to roughly one board square tall.
            const targetHeight = type === 'p' ? 0.62 : 0.95;
            const scale = targetHeight / Math.max(size.y, 0.001);
            root.scale.setScalar(scale);
            root.updateMatrixWorld(true);
            const scaled = new THREE.Box3().setFromObject(root);
            const center = scaled.getCenter(new THREE.Vector3());
            root.position.set(-center.x, -scaled.min.y, -center.z);
            root.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
            models.set(key, root);
          })
          .catch(() => {
            /* no model for this piece: procedural art is used */
          }),
      );
    });
  });

  await Promise.all(jobs);
  return models;
}
