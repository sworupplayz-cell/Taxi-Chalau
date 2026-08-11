export interface DrivingInputState {
  steering: number;
  throttle: boolean;
  brake: boolean;
}

type InputAction = "steerLeft" | "steerRight" | "throttle" | "brake";

type ActionState = Record<InputAction, boolean>;

const KEY_ACTIONS: Readonly<Record<string, InputAction>> = {
  KeyA: "steerLeft",
  ArrowLeft: "steerLeft",
  KeyD: "steerRight",
  ArrowRight: "steerRight",
  KeyW: "throttle",
  ArrowUp: "throttle",
  KeyS: "brake",
  ArrowDown: "brake",
};

const ACTION_LABELS: Readonly<Record<InputAction, string>> = {
  steerLeft: "Steer left",
  steerRight: "Steer right",
  throttle: "Accelerate",
  brake: "Brake or reverse",
};

const ACTIONS: readonly InputAction[] = ["steerLeft", "steerRight", "throttle", "brake"];

function createActionState(): ActionState {
  return {
    steerLeft: false,
    steerRight: false,
    throttle: false,
    brake: false,
  };
}

export class InputController {
  public readonly state: DrivingInputState = {
    steering: 0,
    throttle: false,
    brake: false,
  };

  private readonly keyboardState = createActionState();
  private readonly touchState = createActionState();
  private readonly touchControls: HTMLDivElement;

  public constructor(container: HTMLElement) {
    this.touchControls = this.createTouchControls(container);
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp, { passive: false });
    window.addEventListener("blur", this.clearInput);
  }

  public sync(): DrivingInputState {
    const steerLeft = this.keyboardState.steerLeft || this.touchState.steerLeft;
    const steerRight = this.keyboardState.steerRight || this.touchState.steerRight;

    this.state.steering = steerLeft === steerRight ? 0 : steerLeft ? -1 : 1;
    this.state.throttle = this.keyboardState.throttle || this.touchState.throttle;
    this.state.brake = this.keyboardState.brake || this.touchState.brake;

    return this.state;
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearInput);
    this.touchControls.remove();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_ACTIONS[event.code];
    if (!action) {
      return;
    }

    event.preventDefault();
    this.keyboardState[action] = true;
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_ACTIONS[event.code];
    if (!action) {
      return;
    }

    event.preventDefault();
    this.keyboardState[action] = false;
  };

  private readonly clearInput = (): void => {
    ACTIONS.forEach((action) => {
      this.keyboardState[action] = false;
      this.touchState[action] = false;
    });
  };

  private createTouchControls(container: HTMLElement): HTMLDivElement {
    const controls = document.createElement("div");
    controls.className = "touch-controls";
    controls.setAttribute("aria-label", "Touch driving controls");

    const steering = document.createElement("div");
    steering.className = "touch-controls__group touch-controls__steering";
    steering.append(
      this.createControlButton("steerLeft", "◀"),
      this.createControlButton("steerRight", "▶"),
    );

    const pedals = document.createElement("div");
    pedals.className = "touch-controls__group touch-controls__pedals";
    pedals.append(
      this.createControlButton("brake", "Brake / Reverse"),
      this.createControlButton("throttle", "Accelerate"),
    );

    controls.append(steering, pedals);
    container.append(controls);
    return controls;
  }

  private createControlButton(action: InputAction, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `touch-controls__button touch-controls__button--${action}`;
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", ACTION_LABELS[action]);

    const setActive = (active: boolean, event?: PointerEvent): void => {
      event?.preventDefault();
      this.touchState[action] = active;
      button.classList.toggle("is-active", active);
    };

    button.addEventListener("pointerdown", (event) => {
      setActive(true, event);
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointerup", (event) => setActive(false, event));
    button.addEventListener("pointercancel", (event) => setActive(false, event));
    button.addEventListener("lostpointercapture", () => setActive(false));
    button.addEventListener("contextmenu", (event) => event.preventDefault());

    return button;
  }
}
