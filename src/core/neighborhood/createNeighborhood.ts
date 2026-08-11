import * as THREE from "three";
import { AssetLoader } from "../assets/AssetLoader";

interface BuildingDefinition {
  readonly name: string;
  readonly path: string;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly rotationY: number;
}

const BUILDINGS: readonly BuildingDefinition[] = [
  {
    name: "Commercial Building A",
    path: "assets/environment/buildings/commercial/building-a.glb",
    x: -2,
    z: 2,
    scale: 0.72,
    rotationY: 0,
  },
  {
    name: "Commercial Building B",
    path: "assets/environment/buildings/commercial/building-b.glb",
    x: 2,
    z: 2,
    scale: 0.68,
    rotationY: Math.PI / 2,
  },
  {
    name: "Residential Building B",
    path: "assets/environment/buildings/residential/building-type-b.glb",
    x: -2,
    z: -2,
    scale: 0.62,
    rotationY: 0,
  },
  {
    name: "Modular House B",
    path: "assets/environment/buildings/modular/building-sample-house-b.glb",
    x: 2,
    z: -2,
    scale: 0.62,
    rotationY: Math.PI / 2,
  },
];

function validateBuilding(name: string, model: THREE.Object3D): void {
  let meshCount = 0;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    meshCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => {
      if (!("map" in material)) {
        return true;
      }
      const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
      return !(map instanceof THREE.Texture && map.image !== undefined);
    })) {
      throw new Error(`${name} loaded without its expected material texture.`);
    }
  });

  if (meshCount === 0) {
    throw new Error(`${name} loaded without visible geometry.`);
  }
}

export async function createNeighborhood(assetLoader: AssetLoader): Promise<THREE.Group> {
  const neighborhood = new THREE.Group();
  neighborhood.name = "FirstTaxiNeighborhood";

  const loadedBuildings = await Promise.all(BUILDINGS.map(async (definition) => {
    const gltf = await assetLoader.loadGltf(definition.path);
    validateBuilding(definition.name, gltf.scene);
    return { definition, model: gltf.scene };
  }));

  loadedBuildings.forEach(({ definition, model }) => {
    model.name = definition.name;
    model.scale.setScalar(definition.scale);
    model.rotation.y = definition.rotationY;
    model.position.set(definition.x, 0, definition.z);
    model.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(model);
    model.position.y = -bounds.min.y;
    neighborhood.add(model);
  });

  return neighborhood;
}
