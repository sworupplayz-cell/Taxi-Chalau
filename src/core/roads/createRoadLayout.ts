import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";

export const ROAD_SCALE = 2;
const ROAD_CATALOG_URL = "/assets/environment/roads/road-asset-catalog.json";

interface CatalogConnectionEdge {
  readonly coordinate: number;
  readonly span: [number, number];
  readonly width: number;
}

interface CatalogAsset {
  readonly file: string;
  readonly path: string;
  readonly geometryClass: string;
  readonly loaderVerified: boolean;
  readonly dimensionsSource: [number, number, number];
  readonly pavement: {
    readonly y: number | null;
    readonly boundsXZ: [number, number, number, number] | null;
    readonly connectionEdges: Partial<Record<"north" | "south" | "east" | "west", CatalogConnectionEdge>>;
  };
}

interface RoadCatalog {
  readonly assetCount: number;
  readonly currentGameScale: number;
  readonly assets: readonly CatalogAsset[];
}

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

function validateLoadedModel(name: string, model: THREE.Object3D): void {
  let meshCount = 0;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    meshCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => !hasLoadedTexture(material))) {
      throw new Error(`${name} loaded without its catalogued colormap texture.`);
    }
  });

  if (meshCount === 0) {
    throw new Error(`${name} loaded without visible geometry.`);
  }
}

async function loadRoadCatalog(): Promise<RoadCatalog> {
  const response = await fetch(ROAD_CATALOG_URL);
  if (!response.ok) {
    throw new Error(`Road asset catalog failed to load: HTTP ${response.status}.`);
  }

  const catalog = await response.json() as RoadCatalog;
  if (!Array.isArray(catalog.assets) || catalog.assetCount !== catalog.assets.length) {
    throw new Error("Road asset catalog is incomplete.");
  }

  return catalog;
}

function catalogAsset(catalog: RoadCatalog, file: string): CatalogAsset {
  const asset = catalog.assets.find((entry) => entry.file === file);
  if (!asset || !asset.loaderVerified) {
    throw new Error(`Required catalogued road asset is unavailable: ${file}.`);
  }
  return asset;
}

export async function createRoadLayout(assetLoader: AssetLoader): Promise<RoadLayout> {
  const catalog = await loadRoadCatalog();
  const crossroadAsset = catalogAsset(catalog, "road-crossroad.glb");
  const straightAsset = catalogAsset(catalog, "road-straight.glb");
  const sideAsset = catalogAsset(catalog, "road-side.glb");

  const [crossroadGltf, straightGltf, sideGltf] = await Promise.all([
    assetLoader.loadGltf(crossroadAsset.path),
    assetLoader.loadGltf(straightAsset.path),
    assetLoader.loadGltf(sideAsset.path),
  ]);
  validateLoadedModel(crossroadAsset.file, crossroadGltf.scene);
  validateLoadedModel(straightAsset.file, straightGltf.scene);
  validateLoadedModel(sideAsset.file, sideGltf.scene);

  const crossroadEdges = crossroadAsset.pavement.connectionEdges;
  const straightEdges = straightAsset.pavement.connectionEdges;
  const crossroadPavement = crossroadAsset.pavement.boundsXZ;
  const straightPavement = straightAsset.pavement.boundsXZ;
  const sidePavement = sideAsset.pavement.boundsXZ;
  if (
    !crossroadPavement
    || !straightPavement
    || !sidePavement
    || !crossroadEdges.north
    || !crossroadEdges.south
    || !crossroadEdges.east
    || !crossroadEdges.west
    || !straightEdges.east
    || !straightEdges.west
    || crossroadAsset.pavement.y === null
    || straightAsset.pavement.y === null
    || sideAsset.pavement.y === null
  ) {
    throw new Error("Catalogued road connection data is incomplete for the playable grid.");
  }
  if (
    Math.abs(crossroadAsset.pavement.y - straightAsset.pavement.y) > 0.0001
    || Math.abs(sideAsset.pavement.y - straightAsset.pavement.y) > 0.0001
  ) {
    throw new Error("Catalogued road surface heights are inconsistent.");
  }

  const root = new THREE.Group();
  root.name = "PlayableRoadGrid";
  const place = (source: THREE.Object3D, x: number, z: number, rotationY = 0): void => {
    const instance = source.clone(true);
    instance.position.set(x, 0, z);
    instance.rotation.y = rotationY;
    instance.scale.setScalar(ROAD_SCALE);
    root.add(instance);
  };

  // Each crossroad is separated by two straight visible-pavement tiles.
  // The world spacing is derived from the catalogued connection coordinates.
  const horizontalSpacing = (
    crossroadEdges.east.coordinate - straightEdges.west.coordinate
    + straightEdges.east.coordinate - crossroadEdges.west.coordinate
  ) * ROAD_SCALE;
  const verticalSpacing = (
    crossroadEdges.north.coordinate + straightEdges.east.coordinate
    - straightEdges.west.coordinate - crossroadEdges.south.coordinate
  ) * ROAD_SCALE;
  const gridX = [-horizontalSpacing, 0, horizontalSpacing];
  const gridZ = [-verticalSpacing, 0, verticalSpacing];
  const horizontalConnectors = [
    (crossroadEdges.west.coordinate - straightEdges.east.coordinate) * ROAD_SCALE,
    (crossroadEdges.east.coordinate - straightEdges.west.coordinate) * ROAD_SCALE,
  ];
  const verticalConnectors = [
    (crossroadEdges.south.coordinate + straightEdges.west.coordinate) * ROAD_SCALE,
    (crossroadEdges.north.coordinate + straightEdges.east.coordinate) * ROAD_SCALE,
  ];

  gridZ.forEach((z) => {
    gridX.forEach((x) => place(crossroadGltf.scene, x, z));
    horizontalConnectors.forEach((x) => place(straightGltf.scene, x, z));
  });
  gridX.forEach((x) => {
    verticalConnectors.forEach((z) => place(straightGltf.scene, x, z, Math.PI / 2));
  });

  // Keep edge pieces on the exposed outside perimeter only. Their offsets use
  // the catalogue pavement widths, leaving the four interior lots open.
  const straightWidth = straightPavement[3] - straightPavement[2];
  const sideWidth = sidePavement[1] - sidePavement[0];
  const outsideOffset = (straightWidth + sideWidth) * ROAD_SCALE / 2;
  const leftSideX = gridX[0] - outsideOffset;
  const rightSideX = gridX[2] + outsideOffset;
  const bottomSideZ = gridZ[0] - outsideOffset;
  const topSideZ = gridZ[2] + outsideOffset;
  verticalConnectors.forEach((z) => {
    place(sideGltf.scene, leftSideX, z);
    place(sideGltf.scene, rightSideX, z);
  });
  horizontalConnectors.forEach((x) => {
    place(sideGltf.scene, x, bottomSideZ, Math.PI / 2);
    place(sideGltf.scene, x, topSideZ, Math.PI / 2);
  });

  return {
    root,
    surfaceY: straightAsset.pavement.y * ROAD_SCALE,
    scale: ROAD_SCALE,
  };
}
