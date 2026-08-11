import * as THREE from "three";

export function resizeViewport(
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  container: HTMLElement,
): () => void {
  const resize = (): void => {
    const width = Math.max(container.clientWidth || window.innerWidth, 1);
    const height = Math.max(container.clientHeight || window.innerHeight, 1);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
  };

  window.addEventListener("resize", resize, { passive: true });

  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
  observer?.observe(container);
  resize();

  return (): void => {
    window.removeEventListener("resize", resize);
    observer?.disconnect();
  };
}
