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
  place("curve", tileSize * 2, 0);
  place("straight", tileSize * 2, tileSize);

  // Road-side pieces mark the outside edges without filling the entire test area.
  place("side", tileSize, tileSize);
  place("side", tileSize, -tileSize, Math.PI / 2);
  place("side", -tileSize, -tileSize, Math.PI / 2);

  return { root, surfaceY, scale: ROAD_SCALE };
}
