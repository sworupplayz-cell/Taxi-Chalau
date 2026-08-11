import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";
import { createRenderer } from "../renderer/createRenderer";
import { createScene } from "../scene/createScene";
import { ROAD_SCALE } from "./createRoadLayout";

const ROAD_ASSETS = [
  { key: "straight", label: "road-straight.glb", path: "environment/roads/road-straight.glb" },
  { key: "curve", label: "road-curve.glb", path: "environment/roads/road-curve.glb" },
  { key: "intersection", label: "road-intersection.glb", path: "environment/roads/road-intersection.glb" },
  { key: "end", label: "road-end.glb", path: "environment/roads/road-end.glb" },
  { key: "side", label: "road-side.glb", path: "environment/roads/road-side.glb" },
] as const;

type RoadAssetKey = (typeof ROAD_ASSETS)[number]["key"];
type ConnectionEdge = "left" | "right" | "bottom" | "top";

interface EdgeInterval {
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

interface LoadedRoadAsset {
  readonly model: THREE.Object3D;
  readonly report: RoadAssetReport;
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

function mergeIntervals(intervals: Array<[number, number]>): EdgeInterval | undefined {
  if (intervals.length === 0) {
    return undefined;
  }

  intervals.sort((left, right) => left[0] - right[0]);
  let min = intervals[0][0];
  let max = intervals[0][1];

  for (let index = 1; index < intervals.length; index += 1) {
    min = Math.min(min, intervals[index][0]);
    max = Math.max(max, intervals[index][1]);
  }

  return { min, max, width: max - min };
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

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const edgePoints: Record<ConnectionEdge, Array<[number, number]>> = {
    left: [],
    right: [],
    bottom: [],
    top: [],
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

    const allX: number[] = [];
    const allZ: number[] = [];
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      allX.push(position.getX(vertex));
      allZ.push(position.getZ(vertex));
    }
    const fullMinX = Math.min(...allX);
    const fullMaxX = Math.max(...allX);
    const fullMinZ = Math.min(...allZ);
    const fullMaxZ = Math.max(...allZ);
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
      if (points.some((point) => Math.abs(point.x - fullMinX) < edgeTolerance)) {
        edgePoints.left.push([Math.min(...points.map((point) => point.z)), Math.max(...points.map((point) => point.z))]);
      }
      if (points.some((point) => Math.abs(point.x - fullMaxX) < edgeTolerance)) {
        edgePoints.right.push([Math.min(...points.map((point) => point.z)), Math.max(...points.map((point) => point.z))]);
      }
      if (points.some((point) => Math.abs(point.z - fullMinZ) < edgeTolerance)) {
        edgePoints.bottom.push([Math.min(...points.map((point) => point.x)), Math.max(...points.map((point) => point.x))]);
      }
      if (points.some((point) => Math.abs(point.z - fullMaxZ) < edgeTolerance)) {
        edgePoints.top.push([Math.min(...points.map((point) => point.x)), Math.max(...points.map((point) => point.x))]);
      }
    }
  });

  const edges: Partial<Record<ConnectionEdge, EdgeInterval>> = {};
  (Object.keys(edgePoints) as ConnectionEdge[]).forEach((edge) => {
    const interval = mergeIntervals(edgePoints[edge]);
    if (interval) {
      edges[edge] = interval;
    }
  });

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
  const pavementWidth = pavement.maxX - pavement.minX;
  const pavementLength = pavement.maxZ - pavement.minZ;

  return {
    key,
    label,
    fullDimensions,
    scaledDimensions: fullDimensions.clone().multiplyScalar(ROAD_SCALE),
    pavement,
    sameAxisSpacing: {
      x: pavement.edges.left && pavement.edges.right ? pavementWidth : undefined,
      z: pavement.edges.bottom && pavement.edges.top ? pavementLength : undefined,
    },
  };
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function formatInterval(interval: EdgeInterval | undefined): string {
  if (!interval) {
    return "none";
  }
  return `[${formatNumber(interval.min)}, ${formatNumber(interval.max)}] width ${formatNumber(interval.width)}`;
}

function reportText(report: RoadAssetReport): string {
  const edges = report.pavement.edges;
  const connectionEdges = (Object.keys(edges) as ConnectionEdge[])
    .filter((edge) => edges[edge])
    .map((edge) => `${edge} ${formatInterval(edges[edge])}`)
    .join("\n  ");
  const spacingX = report.sameAxisSpacing.x === undefined ? "not applicable" : `${formatNumber(report.sameAxisSpacing.x)} source / ${formatNumber(report.sameAxisSpacing.x * ROAD_SCALE)} current`;
  const spacingZ = report.sameAxisSpacing.z === undefined ? "not applicable" : `${formatNumber(report.sameAxisSpacing.z)} source / ${formatNumber(report.sameAxisSpacing.z * ROAD_SCALE)} current`;

  return [
    `Asset: ${report.label}`,
    "Inspection transform: scale 1, rotation 0, origin (0, 0, 0)",
    `Full dimensions: ${report.fullDimensions.toArray().map(formatNumber).join(" × ")} source / ${report.scaledDimensions.toArray().map(formatNumber).join(" × ")} at current scale ${ROAD_SCALE}`,
    `Visible pavement bounds: X [${formatNumber(report.pavement.minX)}, ${formatNumber(report.pavement.maxX)}], Z [${formatNumber(report.pavement.minZ)}, ${formatNumber(report.pavement.maxZ)}] source units`,
    `Visible pavement Y: ${formatNumber(report.pavement.y)} source / ${formatNumber(report.pavement.y * ROAD_SCALE)} current`,
    `Pavement dimensions: ${formatNumber(report.pavement.maxX - report.pavement.minX)} × ${formatNumber(report.pavement.maxZ - report.pavement.minZ)} source units`,
    `Pavement-touch connection candidates:\n  ${connectionEdges || "none"}`,
    `Same-axis center spacing from visible pavement: X ${spacingX}; Z ${spacingZ}`,
    "Yellow outline: visible pavement boundary. Gold box: full model bounds. Axes: local origin and X/Y/Z.",
  ].join("\n");
}

function createInspectionCamera(container: HTMLElement): THREE.OrthographicCamera {
  const aspect = Math.max(container.clientWidth || window.innerWidth, 1)
    / Math.max(container.clientHeight || window.innerHeight, 1);
  const camera = new THREE.OrthographicCamera(-aspect * 2, aspect * 2, 2, -2, 0.1, 100);
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function startRoadAssetInspection(container: HTMLElement): () => void {
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
  title.textContent = "Road asset inspection";
  const actions = document.createElement("div");
  actions.className = "road-inspection-panel__actions";
  const reportElement = document.createElement("pre");
  reportElement.className = "road-inspection-panel__report";
  reportElement.textContent = "Loading road assets…";
  panel.append(title, actions, reportElement);
  container.append(panel);

  const loadedAssets: LoadedRoadAsset[] = [];
  let activeIndex = 0;
  let viewSize = 4;
  let ready = false;

  const resize = (): void => {
    const width = Math.max(container.clientWidth || window.innerWidth, 1);
    const height = Math.max(container.clientHeight || window.innerHeight, 1);
    const aspect = width / height;
    camera.left = -viewSize * aspect / 2;
    camera.right = viewSize * aspect / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const showActiveAsset = (): void => {
    const active = loadedAssets[activeIndex];
    if (!active) {
      return;
    }

    inspectionRoot.clear();
    diagnosticsRoot.clear();
    inspectionRoot.add(active.model);

    active.model.position.set(0, 0, 0);
    active.model.rotation.set(0, 0, 0);
    active.model.scale.setScalar(1);
    active.model.updateMatrixWorld(true);

    const fullBounds = new THREE.Box3().setFromObject(active.model);
    const fullSize = fullBounds.getSize(new THREE.Vector3());
    const pavementSize = new THREE.Vector3(
      active.report.pavement.maxX - active.report.pavement.minX,
      0,
      active.report.pavement.maxZ - active.report.pavement.minZ,
    );
    viewSize = Math.max(2.5, Math.max(fullSize.x, fullSize.z, pavementSize.x, pavementSize.z) * 1.8);

    diagnosticsRoot.add(new THREE.AxesHelper(Math.max(fullSize.x, fullSize.z, 1) * 0.75));
    diagnosticsRoot.add(new THREE.Box3Helper(fullBounds, 0xffcc66));

    const boundaryY = active.report.pavement.y + 0.002;
    const boundary = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(active.report.pavement.minX, boundaryY, active.report.pavement.minZ),
        new THREE.Vector3(active.report.pavement.maxX, boundaryY, active.report.pavement.minZ),
        new THREE.Vector3(active.report.pavement.maxX, boundaryY, active.report.pavement.maxZ),
        new THREE.Vector3(active.report.pavement.minX, boundaryY, active.report.pavement.maxZ),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffe066 }),
    );
    diagnosticsRoot.add(boundary);

    camera.position.set(0, Math.max(10, fullSize.y + 8), 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    resize();
    reportElement.textContent = reportText(active.report);
    Array.from(actions.children).forEach((child, index) => {
      child.classList.toggle("is-active", index === activeIndex);
      child.setAttribute("aria-pressed", String(index === activeIndex));
    });
  };

  const selectAsset = (index: number): void => {
    if (index < 0 || index >= loadedAssets.length) {
      return;
    }
    activeIndex = index;
    showActiveAsset();
  };

  const keyHandler = (event: KeyboardEvent): void => {
    const number = Number(event.key);
    if (Number.isInteger(number) && number >= 1 && number <= loadedAssets.length) {
      selectAsset(number - 1);
    } else if (event.key === "ArrowRight") {
      selectAsset((activeIndex + 1) % loadedAssets.length);
    } else if (event.key === "ArrowLeft") {
      selectAsset((activeIndex - 1 + loadedAssets.length) % loadedAssets.length);
    }
  };
  window.addEventListener("keydown", keyHandler);
  window.addEventListener("resize", resize, { passive: true });

  const assetLoader = new AssetLoader();
  void Promise.all(ROAD_ASSETS.map(async (asset) => {
    const gltf = await assetLoader.loadGltf(asset.path);
    validateLoadedModel(asset.label, gltf.scene);
    const report = makeReport(asset.key, asset.label, gltf.scene);
    loadedAssets.push({ model: gltf.scene, report });
  }))
    .then(() => {
      loadedAssets.sort((left, right) => ROAD_ASSETS.findIndex((asset) => asset.key === left.report.key) - ROAD_ASSETS.findIndex((asset) => asset.key === right.report.key));
      ROAD_ASSETS.forEach((asset, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${index + 1}. ${asset.label}`;
        button.addEventListener("click", () => selectAsset(index));
        actions.append(button);
      });
      showActiveAsset();
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
