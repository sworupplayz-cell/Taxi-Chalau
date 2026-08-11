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

function scaled(value: number): number {
  return value * ROAD_SCALE;
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

  const getSource = (pieceName: RoadPieceName): THREE.Object3D => {
    const source = loadedModels.get(pieceName);
    if (!source) {
      throw new Error(`Road asset ${pieceName} was not loaded.`);
    }
    return source;
  };

  const straightSource = getSource("straight");
  const curveSource = getSource("curve");
  const intersectionSource = getSource("intersection");
  const endSource = getSource("end");
  const sideSource = getSource("side");

  const straightBounds = new THREE.Box3().setFromObject(straightSource);
  const curveBounds = new THREE.Box3().setFromObject(curveSource);
  const intersectionBounds = new THREE.Box3().setFromObject(intersectionSource);
  const endBounds = new THREE.Box3().setFromObject(endSource);
  const sideBounds = new THREE.Box3().setFromObject(sideSource);

  const surfaceY = scaled(straightBounds.max.y);
  const intersectionMinX = scaled(intersectionBounds.min.x);
  const intersectionMaxX = scaled(intersectionBounds.max.x);
  const intersectionMinZ = scaled(intersectionBounds.min.z);
  const intersectionMaxZ = scaled(intersectionBounds.max.z);
  const root = new THREE.Group();
  root.name = "RoadTestArea";

  const place = (
    pieceName: RoadPieceName,
    x: number,
    z: number,
    rotationY = 0,
  ): void => {
    const instance = getSource(pieceName).clone(true);
    instance.position.set(x, 0, z);
    instance.rotation.y = rotationY;
    instance.scale.setScalar(ROAD_SCALE);
    root.add(instance);
  };

  // Every position below is derived from the imported model bounds. The
  // intersection is the anchor tile; neighboring pieces touch its edges.
  place("intersection", 0, 0);

  const rightStraightX = intersectionMaxX - scaled(straightBounds.min.x);
  const topStraightZ = intersectionMaxZ - scaled(straightBounds.min.z);
  const roadEndZ = intersectionMinZ - scaled(endBounds.max.z);
  place("straight", rightStraightX, 0);
  place("straight", 0, topStraightZ);
  place("end", 0, roadEndZ);

  // The curve's right edge is the connection to the intersection's left edge.
  // Its upper edge is the only edge used as a route endpoint, so the source
  // bounds align both the curve and its neighboring straight without overlap.
  const curveX = intersectionMinX - scaled(curveBounds.max.x);
  const curveZ = intersectionMaxZ - scaled(curveBounds.max.z);
  place("curve", curveX, curveZ);

  // Side pieces are placed from their actual asymmetric bounds, directly
  // outside the east and north road edges.
  const eastSideX = rightStraightX
    + scaled(straightBounds.max.x)
    - scaled(sideBounds.min.x);
  const northSideX = intersectionMaxX - scaled(sideBounds.min.x);
  const northSideZ = topStraightZ
    + scaled(straightBounds.min.z)
    - scaled(sideBounds.min.z);
  place("side", eastSideX, 0);
  place("side", northSideX, northSideZ);

  return { root, surfaceY, scale: ROAD_SCALE };
}
