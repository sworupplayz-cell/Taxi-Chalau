import * as THREE from "three";
import "./styles.css";
import { FollowCamera } from "./core/camera/FollowCamera";
import { AssetLoader } from "./core/assets/AssetLoader";
import { validateTaxiAsset, TaxiAssetValidationError } from "./core/assets/validateTaxiAsset";
import { TaxiDrivingSystem } from "./core/driving/TaxiDrivingSystem";
import { InputController } from "./core/input/InputController";
import { createRenderer, RendererInitializationError } from "./core/renderer/createRenderer";
import { createRoadLayout } from "./core/roads/createRoadLayout";
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
  const inputController = new InputController(container);
  const assetLoader = new AssetLoader();
  const clock = new THREE.Clock();

  let taxiDriving: TaxiDrivingSystem | undefined;
  let followCamera: FollowCamera | undefined;
  let cameraReady = false;

  void Promise.all([
    createRoadLayout(assetLoader),
    assetLoader.loadGltf("vehicles/player/taxi.glb"),
  ])
    .then(([roadLayout, taxiGltf]) => {
      const taxiReport = validateTaxiAsset(taxiGltf);
      scene.add(roadLayout.root);

      const taxi = taxiGltf.scene;
      taxi.name = "PlayerTaxi";
      taxi.position.set(0, roadLayout.surfaceY - taxiReport.bounds.min.y, 0);
      scene.add(taxi);

      taxiDriving = new TaxiDrivingSystem(taxi, {
        groundY: roadLayout.surfaceY,
        groundOffset: -taxiReport.bounds.min.y,
      });
      followCamera = new FollowCamera(camera, taxi, {
        offset: new THREE.Vector3(0, 4.5, -8),
        lookAtOffset: new THREE.Vector3(0, 0.8, 2),
      });
      followCamera.snap();
      cameraReady = true;
    })
    .catch((error: unknown) => {
      const message = error instanceof TaxiAssetValidationError || error instanceof Error
        ? error.message
        : "The road test area or player taxi could not be loaded.";

      console.error("Road test area startup failed.", error);
      showStartupError(message);
    });

  let animationFrame = 0;
  const renderFrame = (): void => {
    animationFrame = window.requestAnimationFrame(renderFrame);
    const deltaSeconds = clock.getDelta();

    if (!cameraReady || !taxiDriving || !followCamera) {
      return;
    }

    const input = inputController.sync();
    taxiDriving.update(input, deltaSeconds);
    followCamera.update(deltaSeconds);
    renderer.render(scene, camera);
  };

  renderFrame();

  return (): void => {
    window.cancelAnimationFrame(animationFrame);
    inputController.dispose();
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
