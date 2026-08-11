import * as THREE from "three";
import type { DrivingInputState } from "../input/InputController";

export interface TaxiDrivingOptions {
  readonly groundY: number;
  readonly groundOffset: number;
  readonly maxForwardSpeed?: number;
  readonly maxReverseSpeed?: number;
  readonly acceleration?: number;
  readonly reverseAcceleration?: number;
  readonly brakingDeceleration?: number;
  readonly rollingDeceleration?: number;
  readonly steeringRate?: number;
}

const DEFAULTS = {
  maxForwardSpeed: 14,
  maxReverseSpeed: 5,
  acceleration: 7,
  reverseAcceleration: 4,
  brakingDeceleration: 12,
  rollingDeceleration: 3,
  steeringRate: 1.5,
} as const;

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }

  return current + Math.sign(target - current) * maxDelta;
}

export class TaxiDrivingSystem {
  private readonly taxi: THREE.Object3D;
  private readonly groundY: number;
  private readonly groundOffset: number;
  private readonly maxForwardSpeed: number;
  private readonly maxReverseSpeed: number;
  private readonly acceleration: number;
  private readonly reverseAcceleration: number;
  private readonly brakingDeceleration: number;
  private readonly rollingDeceleration: number;
  private readonly steeringRate: number;

  private speed = 0;

  public constructor(taxi: THREE.Object3D, options: TaxiDrivingOptions) {
    this.taxi = taxi;
    this.groundY = options.groundY;
    this.groundOffset = options.groundOffset;
    this.maxForwardSpeed = options.maxForwardSpeed ?? DEFAULTS.maxForwardSpeed;
    this.maxReverseSpeed = options.maxReverseSpeed ?? DEFAULTS.maxReverseSpeed;
    this.acceleration = options.acceleration ?? DEFAULTS.acceleration;
    this.reverseAcceleration = options.reverseAcceleration ?? DEFAULTS.reverseAcceleration;
    this.brakingDeceleration = options.brakingDeceleration ?? DEFAULTS.brakingDeceleration;
    this.rollingDeceleration = options.rollingDeceleration ?? DEFAULTS.rollingDeceleration;
    this.steeringRate = options.steeringRate ?? DEFAULTS.steeringRate;

    this.keepGrounded();
  }

  public get currentSpeed(): number {
    return this.speed;
  }

  public update(input: DrivingInputState, deltaSeconds: number): void {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
    if (delta === 0) {
      return;
    }

    if (input.brake) {
      if (this.speed > 0.05) {
        this.speed = moveTowards(this.speed, 0, this.brakingDeceleration * delta);
      } else {
        this.speed = moveTowards(this.speed, -this.maxReverseSpeed, this.reverseAcceleration * delta);
      }
    } else if (input.throttle) {
      this.speed = moveTowards(this.speed, this.maxForwardSpeed, this.acceleration * delta);
    } else {
      this.speed = moveTowards(this.speed, 0, this.rollingDeceleration * delta);
    }

    this.speed = Math.min(this.speed, this.maxForwardSpeed);
    this.speed = Math.max(this.speed, -this.maxReverseSpeed);

    const speedMagnitude = Math.abs(this.speed);
    if (speedMagnitude > 0.05 && input.steering !== 0) {
      const speedRatio = Math.min(speedMagnitude / this.maxForwardSpeed, 1);
      const highSpeedSensitivity = 1 - speedRatio * 0.55;
      const movementFactor = Math.min(speedMagnitude / 2, 1);
      const reverseFactor = this.speed < 0 ? -1 : 1;
      // The taxi asset faces +Z, while the follow camera is behind it on -Z.
      // In this view, Three.js positive Y rotation moves +Z toward screen-left,
      // so the vehicle turn sign is opposite to the input's left/right sign.
      const vehicleTurnDirection = -input.steering;
      this.taxi.rotation.y += vehicleTurnDirection
        * this.steeringRate
        * highSpeedSensitivity
        * movementFactor
        * reverseFactor
        * delta;
    }

    this.taxi.translateZ(this.speed * delta);
    this.keepGrounded();
  }

  private keepGrounded(): void {
    this.taxi.position.y = this.groundY + this.groundOffset;
  }
}
