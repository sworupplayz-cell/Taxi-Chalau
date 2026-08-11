import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";

export const ROAD_SCALE = 2;

const ROAD_ASSETS = {
  straight: "environment/roads/road-straight.glb",
  crossroad: "environment/roads/road-crossroad.glb",
} as const;

type RoadAssetName = keyof typeof ROAD_ASSETS;
type ConnectionEdge = "north" | "south" | "east" | "west";

export interface RoadLayout {
  readonly root: THREE.Group;
  readonly surfaceY: number;
  readonly scale: number;
}

interface ConnectionEdgeData {
  readonly coordinate: number;
  readonly min: number;
  readonly max: number;
}

interface RoadGeometryReport {
  readonly pavementY: number;
  readonly edges: Partial<Record<ConnectionEdge, ConnectionEdgeData>>;
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

function measureRoadGeometry(model: THREE.Object3D): RoadGeometryReport {
  let pavementY = Number.POSITIVE_INFINITY;
  const fullBounds = new THREE.Box3().setFromObject(model);

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
      const points = ids.map((id) => ({
        x: position.getX(id),
        y: position.getY(id),
        z: position.getZ(id),
        normalY: normal.getY(id),
      }));
      const averageY = points.reduce((sum, point) => sum + point.y, 0) / 3;

      if (
        averageY > 0
        && Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) < 0.0001
        && points.every((point) => point.normalY > 0.9)
      ) {
        pavementY = Math.min(pavementY, averageY);
      }
    }
  });

  if (!Number.isFinite(pavementY)) {
    throw new Error("Road pavement surface could not be measured.");
  }

  const edgePoints: Record<ConnectionEdge, Array<[number, number]>> = {
    north: [],
    south: [],
    east: [],
    west: [],
  };

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
      const points = ids.map((id) => ({
        x: position.getX(id),
        y: position.getY(id),
        z: position.getZ(id),
        normalY: normal.getY(id),
      }));
      const averageY = points.reduce((sum, point) => sum + point.y, 0) / 3;

      if (
        Math.abs(averageY - pavementY) > 0.0001
        || points.some((point) => point.normalY <= 0.9)
      ) {
        continue;
      }

      const xs = points.map((point) => point.x);
      const zs = points.map((point) => point.z);
      const edgeTolerance = 0.0001;
      if (points.some((point) => Math.abs(point.z - fullBounds.max.z) < edgeTolerance)) {
        edgePoints.north.push([Math.min(...xs), Math.max(...xs)]);
      }
      if (points.some((point) => Math.abs(point.z - fullBounds.min.z) < edgeTolerance)) {
        edgePoints.south.push([Math.min(...xs), Math.max(...xs)]);
      }
      if (points.some((point) => Math.abs(point.x - fullBounds.max.x) < edgeTolerance)) {
        edgePoints.east.push([Math.min(...zs), Math.max(...zs)]);
      }
      if (points.some((point) => Math.abs(point.x - fullBounds.min.x) < edgeTolerance)) {
        edgePoints.west.push([Math.min(...zs), Math.max(...zs)]);
      }
    }
  });

  const edges: Partial<Record<ConnectionEdge, ConnectionEdgeData>> = {};
  (Object.keys(edgePoints) as ConnectionEdge[]).forEach((edge) => {
    const intervals = edgePoints[edge];
    if (intervals.length === 0) {
      return;
    }

    intervals.sort((left, right) => left[0] - right[0]);
    edges[edge] = {
      coordinate: edge === "north"
        ? fullBounds.max.z
        : edge === "south"
          ? fullBounds.min.z
          : edge === "east"
            ? fullBounds.max.x
            : fullBounds.min.x,
      min: intervals[0][0],
      max: intervals[intervals.length - 1][1],
    };
  });

  return { pavementY, edges };
}

export async function createRoadLayout(assetLoader: AssetLoader): Promise<RoadLayout> {
  const loaded = new Map<RoadAssetName, THREE.Object3D>();
  await Promise.all(
    Object.entries(ROAD_ASSETS).map(async ([name, path]) => {
      const assetName = name as RoadAssetName;
      const gltf = await assetLoader.loadGltf(path);
      validateRoadModel(assetName, gltf.scene);
      loaded.set(assetName, gltf.scene);
    }),
  );

  const straight = loaded.get("straight");
  const crossroad = loaded.get("crossroad");
  if (!straight || !crossroad) {
    throw new Error("The crossroad and straight road assets were not loaded.");
  }

  const straightReport = measureRoadGeometry(straight);
  const crossroadReport = measureRoadGeometry(crossroad);
  if (Math.abs(straightReport.pavementY - crossroadReport.pavementY) > 0.0001) {
    throw new Error("Crossroad and straight road surfaces are not level.");
  }

  const requiredEdges: ConnectionEdge[] = ["north", "south", "east", "west"];
  if (requiredEdges.some((edge) => !crossroadReport.edges[edge])) {
    throw new Error("The selected crossroad asset does not expose four pavement connections.");
  }
  const crossroadEdges = crossroadReport.edges;
  const straightEdges = straightReport.edges;
  if (!straightEdges.east || !straightEdges.west) {
    throw new Error("The selected straight asset does not expose east/west pavement connections.");
  }
  const eastConnection = crossroadEdges.east;
  const westConnection = crossroadEdges.west;
  const northConnection = crossroadEdges.north;
  const southConnection = crossroadEdges.south;
  if (!eastConnection || !westConnection || !northConnection || !southConnection) {
    throw new Error("The selected crossroad asset does not expose four pavement connections.");
  }

  const root = new THREE.Group();
  root.name = "ValidatedCrossroadTestArea";
  const place = (source: THREE.Object3D, x: number, z: number, rotationY = 0): void => {
    const instance = source.clone(true);
    instance.position.set(x, 0, z);
    instance.rotation.y = rotationY;
    instance.scale.setScalar(ROAD_SCALE);
    root.add(instance);
  };

  place(crossroad, 0, 0);

  // East/west use the straight model's authored X-axis connections.
  const eastX = (
    eastConnection.coordinate - straightEdges.west.coordinate
  ) * ROAD_SCALE;
  const westX = (
    westConnection.coordinate - straightEdges.east.coordinate
  ) * ROAD_SCALE;
  place(straight, eastX, 0);
  place(straight, westX, 0);

  // A 90-degree Y rotation turns the straight model's X-axis connections north/south.
  const northZ = (
    northConnection.coordinate + straightEdges.east.coordinate
  ) * ROAD_SCALE;
  const southZ = (
    southConnection.coordinate + straightEdges.west.coordinate
  ) * ROAD_SCALE;
  place(straight, 0, northZ, Math.PI / 2);
  place(straight, 0, southZ, Math.PI / 2);

  return {
    root,
    surfaceY: straightReport.pavementY * ROAD_SCALE,
    scale: ROAD_SCALE,
  };
}
