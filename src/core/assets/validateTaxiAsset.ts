import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export class TaxiAssetValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TaxiAssetValidationError";
  }
}

export interface TaxiAssetValidationReport {
  readonly meshCount: number;
  readonly materialCount: number;
  readonly texturedMaterialCount: number;
  readonly triangleCount: number;
  readonly bounds: THREE.Box3;
  readonly dimensions: THREE.Vector3;
}

function materialHasTexture(material: THREE.Material): boolean {
  if (!("map" in material)) {
    return false;
  }

  const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
  return map instanceof THREE.Texture;
}

export function validateTaxiAsset(gltf: GLTF): TaxiAssetValidationReport {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  let meshCount = 0;
  let materialCount = 0;
  let texturedMaterialCount = 0;
  let triangleCount = 0;

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    meshCount += 1;

    const position = object.geometry.getAttribute("position");
    if (position) {
      triangleCount += object.geometry.index
        ? object.geometry.index.count / 3
        : position.count / 3;
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      materialCount += 1;
      if (materialHasTexture(material)) {
        texturedMaterialCount += 1;
      }
    });
  });

  const bounds = new THREE.Box3().setFromObject(root);
  const dimensions = bounds.getSize(new THREE.Vector3());

  if (meshCount === 0 || triangleCount === 0) {
    throw new TaxiAssetValidationError("The taxi GLB loaded without visible triangle geometry.");
  }

  if (materialCount === 0 || texturedMaterialCount === 0) {
    throw new TaxiAssetValidationError(
      "The taxi GLB loaded without its expected textured material.",
    );
  }

  return {
    meshCount,
    materialCount,
    texturedMaterialCount,
    triangleCount: Math.round(triangleCount),
    bounds,
    dimensions,
  };
}
