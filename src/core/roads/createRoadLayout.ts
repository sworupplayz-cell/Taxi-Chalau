import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";

export const ROAD_SCALE = 2;
const STRAIGHT_ROAD_ASSET = "environment/roads/road-straight.glb";

export interface RoadLayout {
  readonly root: THREE.Group;
  readonly surfaceY: number;
  readonly scale: number;
  readonly pavementWidth: number;
  readonly pavementLength: number;
  readonly spacing: number;
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
      throw new Error("The straight road asset loaded without its expected colormap texture.");
    }
  });

  if (meshCount === 0) {
    throw new Error("The straight road asset loaded without visible geometry.");
  }
}

interface PavementSurface {
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function measureVisiblePavement(model: THREE.Object3D): PavementSurface {
  let pavementY = Number.POSITIVE_INFINITY;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const position = object.geometry.getAttribute("position");
    const normal = object.geometry.getAttribute("normal");
    const index = object.geometry.index;
    if (!normal || !position) {
      return;
    }

    const triangleCount = index ? index.count / 3 : position.count / 3;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ids = index
        ? [index.getX(triangle * 3), index.getX(triangle * 3 + 1), index.getX(triangle * 3 + 2)]
        : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
      const yValues = ids.map((id) => position.getY(id));
      const normalYValues = ids.map((id) => normal.getY(id));
      const averageY = (yValues[0] + yValues[1] + yValues[2]) / 3;

      if (
        averageY > 0
        && Math.max(...yValues) - Math.min(...yValues) < 0.0001
        && normalYValues.every((value) => value > 0.9)
      ) {
        pavementY = Math.min(pavementY, averageY);
      }
    }
  });

  if (!Number.isFinite(pavementY)) {
    throw new Error("The straight road pavement surface could not be measured.");
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const position = object.geometry.getAttribute("position");
    const normal = object.geometry.getAttribute("normal");
    const index = object.geometry.index;
    if (!normal || !position) {
      return;
    }

    const triangleCount = index ? index.count / 3 : position.count / 3;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ids = index
        ? [index.getX(triangle * 3), index.getX(triangle * 3 + 1), index.getX(triangle * 3 + 2)]
        : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
      const yValues = ids.map((id) => position.getY(id));
      const normalYValues = ids.map((id) => normal.getY(id));
      const averageY = (yValues[0] + yValues[1] + yValues[2]) / 3;

      if (
        Math.abs(averageY - pavementY) < 0.0001
        && normalYValues.every((value) => value > 0.9)
      ) {
        ids.forEach((id) => {
          minX = Math.min(minX, position.getX(id));
          maxX = Math.max(maxX, position.getX(id));
          minZ = Math.min(minZ, position.getZ(id));
          maxZ = Math.max(maxZ, position.getZ(id));
        });
      }
    }
  });

  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) {
    throw new Error("The straight road pavement bounds could not be measured.");
  }

  return { y: pavementY, minX, maxX, minZ, maxZ };
}

export async function createRoadLayout(assetLoader: AssetLoader): Promise<RoadLayout> {
  const gltf = await assetLoader.loadGltf(STRAIGHT_ROAD_ASSET);
  validateRoadModel(gltf.scene);

  const pavement = measureVisiblePavement(gltf.scene);
  const root = new THREE.Group();
  root.name = "StraightRoadTestArea";

  const spacing = (pavement.maxZ - pavement.minZ) * ROAD_SCALE;
  for (let index = 0; index < 5; index += 1) {
    const instance = gltf.scene.clone(true);
    instance.position.set(0, 0, (index - 2) * spacing);
    instance.scale.setScalar(ROAD_SCALE);
    root.add(instance);
  }

  return {
    root,
    surfaceY: pavement.y * ROAD_SCALE,
    scale: ROAD_SCALE,
    pavementWidth: (pavement.maxX - pavement.minX) * ROAD_SCALE,
    pavementLength: (pavement.maxZ - pavement.minZ) * ROAD_SCALE,
    spacing,
  };
}
