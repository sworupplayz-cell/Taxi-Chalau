import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";

export const ROAD_SCALE = 2;
const ROAD_STRAIGHT_ASSET = "environment/roads/road-straight.glb";
const PAVEMENT_LEVEL_EPSILON = 0.0001;

export interface RoadLayout {
  readonly root: THREE.Group;
  readonly surfaceY: number;
  readonly scale: number;
}

function hasLoadedTexture(material: THREE.Material): boolean {
  if (!("map" in material)) {
    return false;
  }

  const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
  return map instanceof THREE.Texture && map.image !== undefined;
}

function validateRoadModel(model: THREE.Object3D): void {
  let meshCount = 0;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    meshCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => !hasLoadedTexture(material))) {
      throw new Error("road-straight.glb loaded without its expected colormap texture.");
    }
  });

  if (meshCount === 0) {
    throw new Error("road-straight.glb loaded without visible geometry.");
  }
}

interface VisiblePavementMetrics {
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function measureVisiblePavement(model: THREE.Object3D): VisiblePavementMetrics {
  const heights: number[] = [];
  const positions: THREE.BufferAttribute[] = [];

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const position = object.geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute)) {
      return;
    }

    positions.push(position);
    for (let index = 0; index < position.count; index += 1) {
      heights.push(position.getY(index));
    }
  });

  if (heights.length === 0) {
    throw new Error("road-straight.glb has no measurable geometry positions.");
  }

  const minY = Math.min(...heights);
  const maxY = Math.max(...heights);
  const targetY = minY + (maxY - minY) / 2;
  const pavementY = heights.reduce((closest, height) => (
    Math.abs(height - targetY) < Math.abs(closest - targetY) ? height : closest
  ), heights[0]);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  positions.forEach((position) => {
    for (let index = 0; index < position.count; index += 1) {
      if (Math.abs(position.getY(index) - pavementY) > PAVEMENT_LEVEL_EPSILON) {
        continue;
      }

      minX = Math.min(minX, position.getX(index));
      maxX = Math.max(maxX, position.getX(index));
      minZ = Math.min(minZ, position.getZ(index));
      maxZ = Math.max(maxZ, position.getZ(index));
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minZ) || maxZ <= minZ) {
    throw new Error("road-straight.glb has no measurable visible pavement surface.");
  }

  return { y: pavementY, minX, maxX, minZ, maxZ };
}

export async function createRoadLayout(assetLoader: AssetLoader): Promise<RoadLayout> {
  const gltf = await assetLoader.loadGltf(ROAD_STRAIGHT_ASSET);
  validateRoadModel(gltf.scene);

  const pavement = measureVisiblePavement(gltf.scene);
  const pavementLength = pavement.maxZ - pavement.minZ;
  const spacing = pavementLength * ROAD_SCALE;
  const surfaceY = pavement.y * ROAD_SCALE;
  const root = new THREE.Group();
  root.name = "StraightRoadTestArea";

  for (let index = -2; index <= 2; index += 1) {
    const instance = gltf.scene.clone(true);
    instance.position.set(0, 0, index * spacing);
    instance.scale.setScalar(ROAD_SCALE);
    root.add(instance);
  }

  return { root, surfaceY, scale: ROAD_SCALE };
}
