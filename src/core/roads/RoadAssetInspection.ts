import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";
import { createRenderer } from "../renderer/createRenderer";
import { createScene } from "../scene/createScene";
import { ROAD_SCALE } from "./createRoadLayout";

const INSPECTION_SCALE = 1;
const INSPECTION_VIEW_SIZE = 4.5;

const ROAD_ASSETS = [
  { key: "straight", label: "road-straight.glb", path: "environment/roads/road-straight.glb" },
  { key: "curve", label: "road-curve.glb", path: "environment/roads/road-curve.glb" },
  { key: "intersection", label: "road-intersection.glb", path: "environment/roads/road-intersection.glb" },
  { key: "end", label: "road-end.glb", path: "environment/roads/road-end.glb" },
  { key: "side", label: "road-side.glb", path: "environment/roads/road-side.glb" },
] as const;

type RoadAssetKey = (typeof ROAD_ASSETS)[number]["key"];
type ConnectionEdge = "north" | "south" | "east" | "west";

interface EdgeInterval {
  readonly coordinate: number;
  readonly min: number;
  readonly max: number;
  readonly width: number;
}

interface PavementReport {
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly edges: Partial<Record<ConnectionEdge, EdgeInterval>>;
}

interface RoadAssetReport {
  readonly key: RoadAssetKey;
  readonly label: string;
  readonly fullDimensions: THREE.Vector3;
  readonly scaledDimensions: THREE.Vector3;
  readonly pavement: PavementReport;
  readonly sameAxisSpacing: { x: number | undefined; z: number | undefined };
}

function hasLoadedTexture(material: THREE.Material): boolean {
  if (!("map" in material)) {
    return false;
  }

  const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
  return map instanceof THREE.Texture && map.image !== undefined;
}

function validateLoadedModel(label: string, model: THREE.Object3D): void {
  let meshCount = 0;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    meshCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => !hasLoadedTexture(material))) {
      throw new Error(`${label} has a material without its loaded colormap texture.`);
    }
  });

  if (meshCount === 0) {
    throw new Error(`${label} has no visible mesh geometry.`);
  }
}

function mergeIntervals(
  intervals: Array<[number, number]>,
  coordinate: number,
): EdgeInterval | undefined {
  if (intervals.length === 0) {
    return undefined;
  }

  intervals.sort((left, right) => left[0] - right[0]);
  const min = intervals[0][0];
  const max = intervals[intervals.length - 1][1];
  return { coordinate, min, max, width: max - min };
}

function measureVisiblePavement(model: THREE.Object3D): PavementReport {
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
    throw new Error("Visible pavement surface could not be measured.");
  }

  const fullBounds = new THREE.Box3().setFromObject(model);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
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

      points.forEach((point) => {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      });

      const edgeTolerance = 0.0001;
      const triangleX = points.map((point) => point.x);
      const triangleZ = points.map((point) => point.z);
      if (points.some((point) => Math.abs(point.z - fullBounds.max.z) < edgeTolerance)) {
        edgePoints.north.push([Math.min(...triangleX), Math.max(...triangleX)]);
      }
      if (points.some((point) => Math.abs(point.z - fullBounds.min.z) < edgeTolerance)) {
        edgePoints.south.push([Math.min(...triangleX), Math.max(...triangleX)]);
      }
      if (points.some((point) => Math.abs(point.x - fullBounds.max.x) < edgeTolerance)) {
        edgePoints.east.push([Math.min(...triangleZ), Math.max(...triangleZ)]);
      }
      if (points.some((point) => Math.abs(point.x - fullBounds.min.x) < edgeTolerance)) {
        edgePoints.west.push([Math.min(...triangleZ), Math.max(...triangleZ)]);
      }
    }
  });

  const edges: Partial<Record<ConnectionEdge, EdgeInterval>> = {
    north: mergeIntervals(edgePoints.north, fullBounds.max.z),
    south: mergeIntervals(edgePoints.south, fullBounds.min.z),
    east: mergeIntervals(edgePoints.east, fullBounds.max.x),
    west: mergeIntervals(edgePoints.west, fullBounds.min.x),
  };

  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) {
    throw new Error("Visible pavement bounds could not be measured.");
  }

  return { y: pavementY, minX, maxX, minZ, maxZ, edges };
}

function makeReport(
  key: RoadAssetKey,
  label: string,
  model: THREE.Object3D,
): RoadAssetReport {
  const fullBounds = new THREE.Box3().setFromObject(model);
  const fullDimensions = fullBounds.getSize(new THREE.Vector3());
  const pavement = measureVisiblePavement(model);

  return {
    key,
    label,
    fullDimensions,
    scaledDimensions: fullDimensions.clone().multiplyScalar(ROAD_SCALE),
    pavement,
    sameAxisSpacing: {
      x: pavement.edges.east && pavement.edges.west
        ? pavement.maxX - pavement.minX
        : undefined,
      z: pavement.edges.north && pavement.edges.south
        ? pavement.maxZ - pavement.minZ
        : undefined,
    },
  };
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function formatEdge(edge: EdgeInterval | undefined): string {
  if (!edge) {
    return "none";
  }
  return `coord ${formatNumber(edge.coordinate)}, span [${formatNumber(edge.min)}, ${formatNumber(edge.max)}], width ${formatNumber(edge.width)}`;
}

function reportText(report: RoadAssetReport): string {
  const edges = report.pavement.edges;
  const spacingX = report.sameAxisSpacing.x === undefined
    ? "not applicable"
    : `${formatNumber(report.sameAxisSpacing.x)} source / ${formatNumber(report.sameAxisSpacing.x * ROAD_SCALE)} current`;
  const spacingZ = report.sameAxisSpacing.z === undefined
    ? "not applicable"
    : `${formatNumber(report.sameAxisSpacing.z)} source / ${formatNumber(report.sameAxisSpacing.z * ROAD_SCALE)} current`;

  return [
    `Asset: ${report.label}`,
    "Inspection transform: scale 1, rotation 0, origin (0, 0, 0)",
    `Full dimensions: ${report.fullDimensions.toArray().map(formatNumber).join(" × ")} source / ${report.scaledDimensions.toArray().map(formatNumber).join(" × ")} at current scale ${ROAD_SCALE}`,
    `Visible pavement bounds: X [${formatNumber(report.pavement.minX)}, ${formatNumber(report.pavement.maxX)}], Z [${formatNumber(report.pavement.minZ)}, ${formatNumber(report.pavement.maxZ)}] source units`,
    `Visible pavement Y: ${formatNumber(report.pavement.y)} source / ${formatNumber(report.pavement.y * ROAD_SCALE)} current`,
    "Connection edge coordinates and usable widths:",
    `  north: ${formatEdge(edges.north)}`,
    `  south: ${formatEdge(edges.south)}`,
    `  east:  ${formatEdge(edges.east)}`,
    `  west:  ${formatEdge(edges.west)}`,
    `Recommended same-axis center spacing: X ${spacingX}; Z ${spacingZ}`,
    "Yellow outline: visible pavement boundary. Gold box: full model bounds. Axes: local origin and X/Y/Z.",
  ].join("\n");
}

function createInspectionCamera(container: HTMLElement): THREE.OrthographicCamera {
  const aspect = Math.max(container.clientWidth || window.innerWidth, 1)
    / Math.max(container.clientHeight || window.innerHeight, 1);
  const camera = new THREE.OrthographicCamera(
    -INSPECTION_VIEW_SIZE * aspect / 2,
    INSPECTION_VIEW_SIZE * aspect / 2,
    INSPECTION_VIEW_SIZE / 2,
    -INSPECTION_VIEW_SIZE / 2,
    0.1,
    100,
  );
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function startRoadAssetInspection(container: HTMLElement): () => void {
  const params = new URLSearchParams(window.location.search);
  const requestedKey = params.get("asset") as RoadAssetKey | null;
  const selectedAsset = ROAD_ASSETS.find((asset) => asset.key === requestedKey) ?? ROAD_ASSETS[0];
  const scene = createScene();
  const renderer = createRenderer(container);
  const camera = createInspectionCamera(container);
  const inspectionRoot = new THREE.Group();
  const diagnosticsRoot = new THREE.Group();
  scene.add(inspectionRoot, diagnosticsRoot);

  const panel = document.createElement("section");
  panel.className = "road-inspection-panel";
  panel.setAttribute("aria-label", "Road asset inspection diagnostics");
  const title = document.createElement("h1");
  title.textContent = `Road asset inspection — ${selectedAsset.label}`;
  const actions = document.createElement("div");
  actions.className = "road-inspection-panel__actions";
  const reportElement = document.createElement("pre");
  reportElement.className = "road-inspection-panel__report";
  reportElement.textContent = "Loading one road asset…";
  panel.append(title, actions, reportElement);
  container.append(panel);

  const resize = (): void => {
    const width = Math.max(container.clientWidth || window.innerWidth, 1);
    const height = Math.max(container.clientHeight || window.innerHeight, 1);
    const aspect = width / height;
    camera.left = -INSPECTION_VIEW_SIZE * aspect / 2;
    camera.right = INSPECTION_VIEW_SIZE * aspect / 2;
    camera.top = INSPECTION_VIEW_SIZE / 2;
    camera.bottom = -INSPECTION_VIEW_SIZE / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const navigateToAsset = (key: RoadAssetKey): void => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "road-inspection");
    nextUrl.searchParams.set("asset", key);
    window.location.href = nextUrl.toString();
  };

  ROAD_ASSETS.forEach((asset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${index + 1}. ${asset.label}`;
    button.classList.toggle("is-active", asset.key === selectedAsset.key);
    button.setAttribute("aria-pressed", String(asset.key === selectedAsset.key));
    button.addEventListener("click", () => navigateToAsset(asset.key));
    actions.append(button);
  });

  const keyHandler = (event: KeyboardEvent): void => {
    const number = Number(event.key);
    if (Number.isInteger(number) && number >= 1 && number <= ROAD_ASSETS.length) {
      navigateToAsset(ROAD_ASSETS[number - 1].key);
    }
  };
  window.addEventListener("keydown", keyHandler);
  window.addEventListener("resize", resize, { passive: true });

  const assetLoader = new AssetLoader();
  let ready = false;
  void assetLoader.loadGltf(selectedAsset.path)
    .then((gltf) => {
      validateLoadedModel(selectedAsset.label, gltf.scene);
      const report = makeReport(selectedAsset.key, selectedAsset.label, gltf.scene);
      inspectionRoot.clear();
      diagnosticsRoot.clear();

      gltf.scene.position.set(0, 0, 0);
      gltf.scene.rotation.set(0, 0, 0);
      gltf.scene.scale.setScalar(INSPECTION_SCALE);
      inspectionRoot.add(gltf.scene);
      gltf.scene.updateMatrixWorld(true);

      const fullBounds = new THREE.Box3().setFromObject(gltf.scene);
      diagnosticsRoot.add(new THREE.AxesHelper(Math.max(fullBounds.max.x - fullBounds.min.x, fullBounds.max.z - fullBounds.min.z, 1) * 0.75));
      diagnosticsRoot.add(new THREE.Box3Helper(fullBounds, 0xffcc66));

      const boundaryY = report.pavement.y + 0.002;
      diagnosticsRoot.add(new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(report.pavement.minX, boundaryY, report.pavement.minZ),
          new THREE.Vector3(report.pavement.maxX, boundaryY, report.pavement.minZ),
          new THREE.Vector3(report.pavement.maxX, boundaryY, report.pavement.maxZ),
          new THREE.Vector3(report.pavement.minX, boundaryY, report.pavement.maxZ),
        ]),
        new THREE.LineBasicMaterial({ color: 0xffe066 }),
      ));

      camera.position.set(0, 20, 0);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
      reportElement.textContent = reportText(report);
      ready = true;
    })
    .catch((error: unknown) => {
      reportElement.textContent = error instanceof Error ? error.message : "Road asset inspection failed.";
      console.error("Road asset inspection failed.", error);
    });

  resize();
  let animationFrame = 0;
  const renderFrame = (): void => {
    animationFrame = window.requestAnimationFrame(renderFrame);
    if (ready) {
      renderer.render(scene, camera);
    }
  };
  renderFrame();

  return (): void => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("keydown", keyHandler);
    window.removeEventListener("resize", resize);
    panel.remove();
    renderer.dispose();
  };
}
