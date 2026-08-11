import * as THREE from "three";
import "./styles.css";
import { AssetLoader } from "./core/assets/AssetLoader";
import { validateTaxiAsset, TaxiAssetValidationError } from "./core/assets/validateTaxiAsset";
import { createRenderer, RendererInitializationError } from "./core/renderer/createRenderer";
import { createCamera, createScene } from "./core/scene/createScene";
import { resizeViewport } from "./core/scene/resizeViewport";

const applicationRoot = document.querySelector<HTMLElement>("#app");

if (!applicationRoot) {
  throw new Error("Application root element was not found.");
}

const app = applicationRoot;

function showStartupError(message: string): void {
  app.replaceChildren();

  const errorContainer = document.createElement("main");
  errorContainer.className = "startup-error";
  errorContainer.setAttribute("role", "alert");

  const errorMessage = document.createElement("p");
  errorMessage.className = "startup-error__message";
  errorMessage.textContent = message;

  errorContainer.append(errorMessage);
  app.append(errorContainer);
}

function startApplication(container: HTMLElement): () => void {
  const scene = createScene();
  const camera = createCamera(1);
  const renderer = createRenderer(container);
  const stopResizeHandling = resizeViewport(camera, renderer, container);
  const assetLoader = new AssetLoader();

  void assetLoader.loadGltf("vehicles/player/taxi.glb")
    .then((gltf) => {
      const report = validateTaxiAsset(gltf);
      const taxi = gltf.scene;
      taxi.name = "PlayerTaxiValidation";
      taxi.position.y = -report.bounds.min.y;
      scene.add(taxi);
    })
    .catch((error: unknown) => {
      const message = error instanceof TaxiAssetValidationError || error instanceof Error
        ? error.message
        : "The player taxi asset could not be loaded or validated.";

      console.error("Player taxi asset validation failed.", error);
      showStartupError(message);
    });

  let animationFrame = 0;
  const renderFrame = (): void => {
    animationFrame = window.requestAnimationFrame(renderFrame);
    renderer.render(scene, camera);
  };

  renderFrame();

  return (): void => {
    window.cancelAnimationFrame(animationFrame);
    stopResizeHandling();
    renderer.dispose();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();

        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  };
}

try {
  const stopApplication = startApplication(app);
  window.addEventListener("beforeunload", stopApplication, { once: true });
} catch (error) {
  const message = error instanceof RendererInitializationError
    ? error.message
    : "The game foundation could not start. Check the browser console for details.";

  console.error("Taxi Sāxi startup failed.", error);
  showStartupError(message);
}
