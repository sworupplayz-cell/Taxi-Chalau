import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";

export const ROAD_SCALE = 2;

const ROAD_ASSETS = {
  straight: "environment/roads/road-straight.glb",
  intersection: "environment/roads/road-intersection.glb",
  side: "environment/roads/road-side.glb",
} as const;

type RoadAssetName = keyof typeof ROAD_ASSETS;

export interface RoadLayout {
  readonly root: THREE.Group;
  readonly surfaceY: number;
  readonly scale: number;
  readonly streetSpacingX: number;
  readonly streetSpacingZ: number;
}

interface PavementSurface {
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function hasLoadedTexture(material: THREE.Material): boolean {
  if (!("map" in material)) {
    return false;
  }

  const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
  return map instanceof THREE.Texture && map.image !== undefined;
}

function validateRoadModel(name: RoadAssetName, model: THREE.Object3D): void {
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

function measureVisiblePavement(model: THREE.Object3D): PavementSurface {
  let pavementY = Number.POSITIVE_INFINITY;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const position = object.geometry.getAttribute("position");
    const normal = object.geometry.getAttribute("normal");
    const index = object.geometry.index;
    if (!position || !normal) {
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
    throw new Error("Visible road pavement could not be measured.");
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
    if (!position || !normal) {
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
    throw new Error("Visible road pavement bounds could not be measured.");
  }

  return { y: pavementY, minX, maxX, minZ, maxZ };
}

export async function createRoadLayout(assetLoader: AssetLoader): Promise<RoadLayout> {
  const loadedModels = new Map<RoadAssetName, THREE.Object3D>();

  await Promise.all(
    Object.entries(ROAD_ASSETS).map(async ([name, assetPath]) => {
      const assetName = name as RoadAssetName;
      const gltf = await assetLoader.loadGltf(assetPath);
      validateRoadModel(assetName, gltf.scene);
      loadedModels.set(assetName, gltf.scene);
    }),
  );

  const getSource = (name: RoadAssetName): THREE.Object3D => {
    const source = loadedModels.get(name);
    if (!source) {
      throw new Error(`Road asset ${name} was not loaded.`);
    }
    return source;
  };

  const straightSource = getSource("straight");
  const intersectionSource = getSource("intersection");
  const sideSource = getSource("side");
  const straightPavement = measureVisiblePavement(straightSource);
  const intersectionPavement = measureVisiblePavement(intersectionSource);
  const sidePavement = measureVisiblePavement(sideSource);

  if (Math.abs(straightPavement.y - intersectionPavement.y) > 0.0001) {
    throw new Error("Straight and intersection road surfaces are not level.");
  }

  const surfaceY = straightPavement.y * ROAD_SCALE;
  const streetSpacingX = (
    intersectionPavement.maxX
    - straightPavement.minZ
    + straightPavement.maxZ
    - intersectionPavement.minX
  ) * ROAD_SCALE;
  const streetSpacingZ = (
    intersectionPavement.maxZ
    - straightPavement.minZ
    + straightPavement.maxZ
    - intersectionPavement.minZ
  ) * ROAD_SCALE;
  const gridXCoordinates = [-streetSpacingX, 0, streetSpacingX];
  const gridZCoordinates = [-streetSpacingZ, 0, streetSpacingZ];
  const horizontalConnectorCoordinates = [
    (intersectionPavement.minX - straightPavement.maxZ) * ROAD_SCALE,
    (intersectionPavement.maxX - straightPavement.minZ) * ROAD_SCALE,
  ];
  const verticalConnectorCoordinates = [
    (intersectionPavement.minZ - straightPavement.maxZ) * ROAD_SCALE,
    (intersectionPavement.maxZ - straightPavement.minZ) * ROAD_SCALE,
  ];
  const root = new THREE.Group();
  root.name = "ModularRoadGrid";

  const place = (name: RoadAssetName, x: number, z: number, rotationY = 0): void => {
    const instance = getSource(name).clone(true);
    instance.position.set(x, 0, z);
    instance.rotation.y = rotationY;
    instance.scale.setScalar(ROAD_SCALE);
    root.add(instance);
  };

  // Three parallel horizontal streets, with three intersections per street.
  gridZCoordinates.forEach((z) => {
    gridXCoordinates.forEach((x) => place("intersection", x, z));
    horizontalConnectorCoordinates.forEach((x) => place("straight", x, z, Math.PI / 2));
  });

  // Three parallel vertical streets, using the measured asymmetric connector edges.
  gridXCoordinates.forEach((x) => {
    verticalConnectorCoordinates.forEach((z) => place("straight", x, z));
  });

  // Side pieces are kept to the outside perimeter and aligned from their
  // measured visible pavement bounds. Interior block edges remain open lots.
  const roadHalfWidth = (straightPavement.maxX - straightPavement.minX) * ROAD_SCALE / 2;
  const sideHalfWidth = (sidePavement.maxX - sidePavement.minX) * ROAD_SCALE / 2;
  const outerSideOffset = roadHalfWidth + sideHalfWidth;
  const leftOuterX = gridXCoordinates[0] - outerSideOffset;
  const rightOuterX = gridXCoordinates[2] + outerSideOffset;
  const bottomOuterZ = gridZCoordinates[0] - outerSideOffset;
  const topOuterZ = gridZCoordinates[2] + outerSideOffset;

  verticalConnectorCoordinates.forEach((z) => {
    place("side", leftOuterX, z);
    place("side", rightOuterX, z);
  });
  horizontalConnectorCoordinates.forEach((x) => {
    place("side", x, bottomOuterZ, Math.PI / 2);
    place("side", x, topOuterZ, Math.PI / 2);
  });

  return { root, surfaceY, scale: ROAD_SCALE, streetSpacingX, streetSpacingZ };
}
