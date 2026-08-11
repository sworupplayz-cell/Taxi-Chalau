import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";

export const ROAD_SCALE = 2;

type RoadPieceName = "straight" | "curve" | "intersection" | "end" | "side";

const ROAD_ASSETS: Readonly<Record<RoadPieceName, string>> = {
  straight: "environment/roads/road-straight.glb",
  curve: "environment/roads/road-curve.glb",
  intersection: "environment/roads/road-intersection.glb",
  end: "environment/roads/road-end.glb",
  side: "environment/roads/road-side.glb",
};

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

function validateRoadModel(name: RoadPieceName, model: THREE.Object3D): void {
  let meshCount = 0;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    meshCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => !hasLoadedTexture(material))) {
      throw new Error(`Road asset ${name} loaded without its expected colormap texture.`);
    }
  });

  if (meshCount === 0) {
    throw new Error(`Road asset ${name} loaded without visible geometry.`);
  }
}

export async function createRoadLayout(assetLoader: AssetLoader): Promise<RoadLayout> {
  const loadedModels = new Map<RoadPieceName, THREE.Object3D>();

  await Promise.all(
    Object.entries(ROAD_ASSETS).map(async ([name, assetPath]) => {
      const pieceName = name as RoadPieceName;
      const gltf = await assetLoader.loadGltf(assetPath);
      validateRoadModel(pieceName, gltf.scene);
      loadedModels.set(pieceName, gltf.scene);
    }),
  );

  const straightSource = loadedModels.get("straight");
  if (!straightSource) {
    throw new Error("The straight road source model was not loaded.");
  }

  const sourceBounds = new THREE.Box3().setFromObject(straightSource);
  const surfaceY = sourceBounds.max.y * ROAD_SCALE;
  const tileSize = ROAD_SCALE;
  const sideSource = loadedModels.get("side");
  if (!sideSource) {
    throw new Error("The road-side source model was not loaded.");
  }

  const sideBounds = new THREE.Box3().setFromObject(sideSource);
  const sideMinZ = sideBounds.min.z * ROAD_SCALE;
  const sideMaxZ = sideBounds.max.z * ROAD_SCALE;
  const northSideZ = tileSize / 2 - sideMinZ;
  const westSideX = -tileSize / 2 - sideMaxZ;
  const root = new THREE.Group();
  root.name = "RoadTestArea";

  const place = (
    pieceName: RoadPieceName,
    x: number,
    z: number,
    rotationY = 0,
  ): void => {
    const source = loadedModels.get(pieceName);
    if (!source) {
      throw new Error(`Road asset ${pieceName} was not loaded.`);
    }

    const instance = source.clone(true);
    instance.position.set(x, 0, z);
    instance.rotation.y = rotationY;
    instance.scale.setScalar(ROAD_SCALE);
    root.add(instance);
  };

  // Core crossroad: each one-unit source tile is uniformly scaled to two meters.
  place("intersection", 0, 0);
  place("straight", 0, tileSize);
  place("straight", -tileSize, 0, Math.PI / 2);
  place("straight", tileSize, 0, Math.PI / 2);
  place("end", 0, -tileSize);

  // A right-hand curve extends the east branch and ends in a northbound straight.
  // The curve is a two-unit source span, so its center sits one half-tile
  // beyond the east straight's edge rather than overlapping that tile.
  const curveCenterX = tileSize * 2.5;
  const curveExitZ = tileSize * 1.5;
  place("curve", curveCenterX, 0);
  place("straight", curveCenterX, curveExitZ);

  // Road-side pieces mark the outside edges without crossing the adjacent tiles.
  // Their source bounds are asymmetric, so their centers are aligned from their
  // actual edges rather than from their nominal origin.
  place("side", -tileSize, northSideZ);
  place("side", westSideX, -tileSize, Math.PI / 2);

  return { root, surfaceY, scale: ROAD_SCALE };
}
