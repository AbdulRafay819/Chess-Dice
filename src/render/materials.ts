import * as THREE from 'three';
import type { Color } from '../shared/types';
import { woodTexture } from './textures';

export interface PieceMaterials {
  body: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshStandardMaterial;
  slit: THREE.MeshStandardMaterial;
}

/**
 * Polished stone for White, oiled ebony for Black, both with gold trim.
 * Each piece owns its materials so selection glow can pulse independently.
 */
export function createPieceMaterials(color: Color): PieceMaterials {
  const body =
    color === 'w'
      ? new THREE.MeshPhysicalMaterial({
          color: 0xded2be,
          roughness: 0.38,
          metalness: 0.02,
          clearcoat: 0.45,
          clearcoatRoughness: 0.3,
          sheen: 0.3,
          sheenRoughness: 0.6,
          sheenColor: new THREE.Color(0xffeedd),
          envMapIntensity: 0.75,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0x1b1c24,
          roughness: 0.34,
          metalness: 0.1,
          clearcoat: 0.55,
          clearcoatRoughness: 0.26,
          sheen: 0.25,
          sheenColor: new THREE.Color(0x4c5870),
          envMapIntensity: 0.95,
        });

  const gold = new THREE.MeshStandardMaterial({
    color: 0xc9a24d,
    roughness: 0.26,
    metalness: 0.95,
    envMapIntensity: 1.4,
  });

  const slit = new THREE.MeshStandardMaterial({
    color: 0x14151a,
    roughness: 0.6,
    metalness: 0.1,
  });

  return { body, gold, slit };
}

export interface BoardMaterials {
  light: THREE.MeshPhysicalMaterial;
  dark: THREE.MeshPhysicalMaterial;
  frame: THREE.MeshPhysicalMaterial;
  inlay: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
}

export function createBoardMaterials(): BoardMaterials {
  const lightTex = woodTexture({ base: '#c49a63', fibre: '#7d5227', seed: 11, repeat: 1 });
  const darkTex = woodTexture({ base: '#4d2c17', fibre: '#1f1006', seed: 29, repeat: 1 });
  const frameTex = woodTexture({ base: '#412616', fibre: '#160b05', seed: 47, repeat: 2 });

  return {
    light: new THREE.MeshPhysicalMaterial({
      map: lightTex,
      roughness: 0.42,
      metalness: 0.03,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.45,
    }),
    dark: new THREE.MeshPhysicalMaterial({
      map: darkTex,
      roughness: 0.45,
      metalness: 0.03,
      clearcoat: 0.4,
      clearcoatRoughness: 0.32,
      envMapIntensity: 0.45,
    }),
    frame: new THREE.MeshPhysicalMaterial({
      map: frameTex,
      roughness: 0.36,
      metalness: 0.05,
      clearcoat: 0.7,
      clearcoatRoughness: 0.25,
      envMapIntensity: 1,
    }),
    inlay: new THREE.MeshStandardMaterial({
      color: 0x191512,
      roughness: 0.72,
      metalness: 0.12,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: 0xb99552,
      roughness: 0.35,
      metalness: 0.85,
      envMapIntensity: 1.2,
    }),
  };
}
