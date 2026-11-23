import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Color, PieceType } from '../shared/types';
import type { PieceMaterials } from './materials';

type Profile = [number, number][];

function lathe(profile: Profile, segments = 40): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(Math.max(radius, 0.0001), y)),
    segments,
  );
}

const PAWN_BODY: Profile = [
  [0.0, 0.0],
  [0.30, 0.0],
  [0.305, 0.028],
  [0.285, 0.055],
  [0.235, 0.075],
  [0.195, 0.1],
  [0.15, 0.13],
  [0.118, 0.2],
  [0.112, 0.27],
  [0.145, 0.305],
  [0.185, 0.33],
  [0.185, 0.355],
  [0.125, 0.375],
  [0.105, 0.405],
  [0.135, 0.45],
  [0.175, 0.49],
  [0.175, 0.515],
  [0.12, 0.535],
  [0.0, 0.548],
];

const ROOK_BODY: Profile = [
  [0.0, 0.0],
  [0.315, 0.0],
  [0.32, 0.03],
  [0.3, 0.06],
  [0.25, 0.085],
  [0.215, 0.12],
  [0.205, 0.18],
  [0.2, 0.32],
  [0.205, 0.42],
  [0.24, 0.46],
  [0.25, 0.49],
  [0.235, 0.52],
  [0.235, 0.56],
  [0.22, 0.58],
  [0.0, 0.585],
];

const BISHOP_BODY: Profile = [
  [0.0, 0.0],
  [0.315, 0.0],
  [0.32, 0.03],
  [0.295, 0.058],
  [0.235, 0.08],
  [0.185, 0.115],
  [0.135, 0.16],
  [0.115, 0.24],
  [0.125, 0.33],
  [0.195, 0.37],
  [0.205, 0.4],
  [0.15, 0.43],
  [0.13, 0.46],
  [0.15, 0.49],
  [0.17, 0.52],
  [0.145, 0.55],
  [0.0, 0.565],
];

const BISHOP_MITRE: Profile = [
  [0.0, 0.0],
  [0.135, 0.0],
  [0.155, 0.02],
  [0.185, 0.07],
  [0.2, 0.14],
  [0.175, 0.21],
  [0.11, 0.27],
  [0.05, 0.3],
  [0.0, 0.305],
];

const QUEEN_BODY: Profile = [
  [0.0, 0.0],
  [0.335, 0.0],
  [0.34, 0.032],
  [0.315, 0.062],
  [0.25, 0.085],
  [0.19, 0.12],
  [0.145, 0.17],
  [0.125, 0.26],
  [0.135, 0.36],
  [0.21, 0.4],
  [0.22, 0.435],
  [0.16, 0.465],
  [0.14, 0.5],
  [0.17, 0.54],
  [0.2, 0.58],
  [0.175, 0.61],
  [0.0, 0.625],
];

const QUEEN_CROWN: Profile = [
  [0.0, 0.0],
  [0.175, 0.0],
  [0.2, 0.02],
  [0.235, 0.08],
  [0.245, 0.135],
  [0.215, 0.175],
  [0.16, 0.2],
  [0.0, 0.205],
];

const KING_BODY: Profile = [
  [0.0, 0.0],
  [0.34, 0.0],
  [0.345, 0.032],
  [0.32, 0.064],
  [0.255, 0.088],
  [0.195, 0.125],
  [0.15, 0.18],
  [0.13, 0.28],
  [0.14, 0.38],
  [0.215, 0.42],
  [0.225, 0.455],
  [0.165, 0.485],
  [0.145, 0.52],
  [0.175, 0.56],
  [0.205, 0.6],
  [0.18, 0.63],
  [0.0, 0.645],
];

const KING_CROWN: Profile = [
  [0.0, 0.0],
  [0.18, 0.0],
  [0.21, 0.025],
  [0.235, 0.09],
  [0.235, 0.15],
  [0.2, 0.185],
  [0.13, 0.2],
  [0.0, 0.205],
];

/** Carved knight silhouette, extruded and bevelled. Faces +X. */
function knightGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.17, 0);
  shape.lineTo(0.19, 0);
  shape.lineTo(0.2, 0.055);
  shape.lineTo(0.11, 0.115);
  shape.lineTo(0.05, 0.235);
  shape.lineTo(0.15, 0.33);
  shape.lineTo(0.245, 0.41);
  shape.lineTo(0.235, 0.485);
  shape.lineTo(0.12, 0.545);
  shape.lineTo(0.0, 0.515);
  shape.lineTo(-0.09, 0.6);
  shape.lineTo(-0.145, 0.5);
  shape.lineTo(-0.17, 0.37);
  shape.lineTo(-0.215, 0.19);
  shape.lineTo(-0.17, 0.01);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.024,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -0.1);
  geometry.computeVertexNormals();
  return geometry;
}

function addGoldBand(
  group: THREE.Group,
  materials: PieceMaterials,
  radius: number,
  y: number,
  tube = 0.018,
) {
  const band = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 44), materials.gold);
  band.rotation.x = Math.PI / 2;
  band.position.y = y;
  group.add(band);
}

/**
 * A Staunton-profile piece built from lathed profiles, extrusion and gold trim.
 * Returns a group whose meshes all share `materials`, so selection glow can
 * pulse them together.
 */
export function buildProceduralPiece(
  type: PieceType,
  color: Color,
  materials: PieceMaterials,
): THREE.Group {
  const group = new THREE.Group();
  const body = materials.body;
  const gold = materials.gold;
  const add = (mesh: THREE.Mesh, y = 0) => {
    mesh.position.y += y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  add(new THREE.Mesh(lathe(PAWN_BODY), body));

  switch (type) {
    case 'p': {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.152, 26, 20), body);
      add(head, 0.63);
      addGoldBand(group, materials, 0.18, 0.36, 0.014);
      break;
    }
    case 'r': {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.225, 0.06, 34), body);
      add(top, 0.6);
      const rimHeight = 0.09;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const crenel = new THREE.Mesh(
          new THREE.BoxGeometry(0.085, rimHeight, 0.075),
          body,
        );
        crenel.position.set(Math.cos(angle) * 0.165, 0.665, Math.sin(angle) * 0.165);
        crenel.rotation.y = -angle;
        crenel.castShadow = true;
        group.add(crenel);
      }
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 28), body), 0.61);
      addGoldBand(group, materials, 0.245, 0.47, 0.017);
      break;
    }
    case 'n': {
      // Replace the pawn-like base cap with the carved head.
      const head = new THREE.Mesh(knightGeometry(), body);
      head.position.set(0, 0.13, 0);
      head.castShadow = true;
      head.receiveShadow = true;
      group.add(head);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 10, 36), gold);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.2;
      group.add(collar);
      addGoldBand(group, materials, 0.245, 0.5, 0.016);
      break;
    }
    case 'b': {
      const mitre = new THREE.Mesh(lathe(BISHOP_MITRE, 34), body);
      add(mitre, 0.55);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.19), materials.slit);
      slit.position.set(0.02, 0.77, 0);
      slit.rotation.z = -0.35;
      group.add(slit);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 16), gold), 0.9);
      addGoldBand(group, materials, 0.205, 0.4, 0.016);
      break;
    }
    case 'q': {
      const crown = new THREE.Mesh(lathe(QUEEN_CROWN, 36), body);
      add(crown, 0.6);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), gold);
        spike.position.set(Math.cos(angle) * 0.205, 0.79, Math.sin(angle) * 0.205);
        spike.castShadow = true;
        group.add(spike);
      }
      add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 22, 18), gold), 0.86);
      addGoldBand(group, materials, 0.235, 0.45, 0.017);
      break;
    }
    case 'k': {
      const crown = new THREE.Mesh(lathe(KING_CROWN, 36), body);
      add(crown, 0.63);
      const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.23, 0.062), gold);
      vertical.position.y = 0.95;
      vertical.castShadow = true;
      group.add(vertical);
      const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.058, 0.056), gold);
      horizontal.position.y = 0.97;
      horizontal.castShadow = true;
      group.add(horizontal);
      addGoldBand(group, materials, 0.24, 0.47, 0.017);
      break;
    }
  }

  group.userData.type = type;
  group.userData.color = color;
  group.userData.materials = [body];
  return group;
}

/** Glowing shell that reads as a rim light around a selected piece. */
export function buildOutline(source: THREE.Object3D, color: number): THREE.Group {
  const outline = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const shells: THREE.Mesh[] = [];
  source.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const shell = new THREE.Mesh(mesh.geometry, material);
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.scale.copy(mesh.scale).multiplyScalar(1.055);
    shell.renderOrder = 2;
    shells.push(shell);
    outline.add(shell);
  });
  outline.userData.material = material;
  outline.userData.shells = shells;
  return outline;
}

export function pieceHeight(type: PieceType): number {
  return type === 'p' ? 0.78 : type === 'n' ? 0.78 : type === 'k' ? 1.05 : 0.95;
}

export { RoundedBoxGeometry };
