import * as THREE from "three";

export class RendererInitializationError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RendererInitializationError";

    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  try {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setAnimationLoop(null);

    renderer.domElement.setAttribute("aria-label", "Taxi Sāxi Kathmandu 3D viewport");
    container.appendChild(renderer.domElement);

    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      console.error("WebGL context was lost. Rendering will stop until the context is restored.");
    });

    return renderer;
  } catch (error) {
    throw new RendererInitializationError(
      "Unable to initialize WebGL. The current browser or device may not support WebGL.",
      error,
    );
  }
}
