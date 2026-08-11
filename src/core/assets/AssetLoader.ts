import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export class AssetLoadError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AssetLoadError";

    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function toAssetUrl(assetPath: string): string {
  const normalizedPath = assetPath.replace(/^\/+/, "").replace(/^assets\//, "");

  if (!normalizedPath || normalizedPath.includes("..")) {
    throw new AssetLoadError(`Invalid public asset path: ${assetPath}`);
  }

  return `/assets/${normalizedPath}`;
}

export class AssetLoader {
  private readonly gltfLoader = new GLTFLoader();

  public loadGltf(assetPath: string): Promise<GLTF> {
    let url: string;

    try {
      url = toAssetUrl(assetPath);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise<GLTF>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        resolve,
        undefined,
        (error) => {
          reject(new AssetLoadError(`Failed to load GLB/glTF asset at ${url}.`, error));
        },
      );
    });
  }
}
