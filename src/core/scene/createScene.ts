import * as THREE from "three";

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db4c0);
  scene.fog = new THREE.Fog(0x9db4c0, 35, 120);

  const hemisphereLight = new THREE.HemisphereLight(0xddebf2, 0x4b5a4e, 1.8);
  scene.add(hemisphereLight);

  const directionalLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
  directionalLight.position.set(12, 20, 10);
  scene.add(directionalLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({
      color: 0x68786e,
      roughness: 1,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = "TestGround";
  scene.add(ground);

  return scene;
}

export function createCamera(aspectRatio: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, aspectRatio, 0.1, 200);
  camera.position.set(0, 5.5, 10);
  camera.lookAt(0, 0, 0);
  return camera;
}
