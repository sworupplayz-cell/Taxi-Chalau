import * as THREE from "three";

export interface FollowCameraOptions {
  readonly offset?: THREE.Vector3;
  readonly lookAtOffset?: THREE.Vector3;
}

const DEFAULT_OFFSET = new THREE.Vector3(0, 3.2, -6.5);
const DEFAULT_LOOK_AT_OFFSET = new THREE.Vector3(0, 0.65, 0);

export class FollowCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.Object3D;
  private readonly offset = new THREE.Vector3();
  private readonly lookAtOffset = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly previousQuaternion = new THREE.Quaternion();
  private readonly desiredQuaternion = new THREE.Quaternion();

  public constructor(
    camera: THREE.PerspectiveCamera,
    target: THREE.Object3D,
    options: FollowCameraOptions = {},
  ) {
    this.camera = camera;
    this.target = target;
    this.offset.copy(options.offset ?? DEFAULT_OFFSET);
    this.lookAtOffset.copy(options.lookAtOffset ?? DEFAULT_LOOK_AT_OFFSET);
  }

  public snap(): void {
    this.calculateDesiredTransform();
    this.camera.position.copy(this.desiredPosition);
    this.camera.lookAt(this.desiredTarget);
  }

  public update(deltaSeconds: number): void {
    this.calculateDesiredTransform();

    const smoothing = 1 - Math.exp(-7 * Math.min(Math.max(deltaSeconds, 0), 0.05));
    this.camera.position.lerp(this.desiredPosition, smoothing);

    this.previousQuaternion.copy(this.camera.quaternion);
    this.camera.lookAt(this.desiredTarget);
    this.desiredQuaternion.copy(this.camera.quaternion);
    this.camera.quaternion.copy(this.previousQuaternion).slerp(this.desiredQuaternion, smoothing);
  }

  private calculateDesiredTransform(): void {
    this.desiredPosition.copy(this.offset).applyQuaternion(this.target.quaternion).add(this.target.position);
    this.desiredTarget.copy(this.lookAtOffset).applyQuaternion(this.target.quaternion).add(this.target.position);
  }
}
