export const FORWARD_COMMAND = 4.5;
export const POLICY_DT = 0.02;
export const PHYSICS_STEPS = 10;
export const COURSE_COMPLETE = 'Course complete';
const FAR_INTERVAL = 5;
const IMAGE_WIDTH = 32;
const IMAGE_HEIGHT = 24;
const PIXELS = IMAGE_WIDTH * IMAGE_HEIGHT;
const DEFAULT_POSE = [0, -0.8, 1.6];
const NATIVE_JOINTS = [0, 3, 6, 9, 1, 4, 7, 10, 2, 5, 8, 11];

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function resetRobot(data) {
  const position = data.qpos;
  position[2] = 0.34;
  for (let joint = 0; joint < 12; joint++) position[7 + joint] = DEFAULT_POSE[joint % 3];
}

export function observation(data, trunkId, lastAction) {
  const position = data.qpos;
  const velocity = data.qvel;
  const rotation = data.xmat;
  const obs = new Float32Array(45);
  for (let i = 0; i < 3; i++) {
    obs[i] = velocity[3 + i] * 0.2;
    obs[3 + i] = -rotation[9 * trunkId + 6 + i];
  }
  obs[6] = FORWARD_COMMAND;
  const heading = Math.atan2(rotation[9 * trunkId + 3], rotation[9 * trunkId]);
  obs[8] = clamp(-0.5 * heading, -1, 1);
  for (let lab = 0; lab < NATIVE_JOINTS.length; lab++) {
    const native = NATIVE_JOINTS[lab];
    obs[9 + lab] = position[7 + native] - DEFAULT_POSE[native % 3];
    obs[21 + lab] = velocity[6 + native] * 0.05;
    obs[33 + lab] = lastAction[lab];
  }
  return obs.map((value) => clamp(value, -100, 100));
}

function rayBox(ox, oy, oz, dx, dy, dz, box) {
  let enter = 0;
  let exit = 10;
  for (let axis = 0; axis < 3; axis++) {
    const low = axis === 0 ? box.begin : axis === 1 ? -box.width / 2 : box.bottom;
    const high = axis === 0 ? box.end : axis === 1 ? box.width / 2 : box.top;
    const origin = axis === 0 ? ox : axis === 1 ? oy : oz;
    const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
    if (Math.abs(direction) < 1e-10) {
      if (origin < low || origin > high) return 10;
      continue;
    }
    const a = (low - origin) / direction;
    const b = (high - origin) / direction;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return 10;
  }
  return enter;
}

export function sampleDepth(data, cameraId, boxes) {
  const camera = data.cam_xpos;
  const rotation = data.cam_xmat;
  const o = cameraId * 3;
  const r = cameraId * 9;
  const near = new Float32Array(PIXELS);
  const far = new Float32Array(PIXELS);
  for (let row = 0; row < IMAGE_HEIGHT; row++) {
    const v = (IMAGE_HEIGHT / 2 - row - 0.5) / 21.648573;
    for (let col = 0; col < IMAGE_WIDTH; col++) {
      const u = (col + 0.5 - IMAGE_WIDTH / 2) / 16.860482;
      // Camera frame uses -Z forward and +Y upward. Keeping z=-1 measures axial depth.
      const dx = rotation[r] * u + rotation[r + 1] * v - rotation[r + 2];
      const dy = rotation[r + 3] * u + rotation[r + 4] * v - rotation[r + 5];
      const dz = rotation[r + 6] * u + rotation[r + 7] * v - rotation[r + 8];
      let metres = 10;
      for (const box of boxes) {
        metres = Math.min(metres, rayBox(camera[o], camera[o + 1], camera[o + 2], dx, dy, dz, box));
      }
      if (metres < 0.2) metres = 10;
      const index = row * IMAGE_WIDTH + col;
      near[index] = (Math.min(metres, 2) - 0.2) / 1.8 - 0.5;
      far[index] = (metres - 0.2) / 9.8 - 0.5;
    }
  }
  return { near, far };
}

export class ParkourPolicy {
  constructor(ort, encoder, actor) {
    this.ort = ort;
    this.encoder = encoder;
    this.actor = actor;
    this.reset();
  }

  reset() {
    const emptyState = () => this.tensor(new Float32Array(128), [1, 1, 128]);
    this.encoderState = { h0: emptyState(), c0: emptyState(), far_h0: emptyState(), far_c0: emptyState() };
    this.actorState = { h0: emptyState(), c0: emptyState() };
    this.previousAction = new Float32Array(12);
    this.stepIndex = 0;
  }

  tensor(values, shape) {
    return new this.ort.Tensor('float32', values, shape);
  }

  async infer(data, trunkId, cameraId, course) {
    const obs = observation(data, trunkId, this.previousAction);
    const depth = sampleDepth(data, cameraId, course.boxes);
    const encoder = await this.encoder.run({
      obs: this.tensor(obs, [1, 45]),
      depth_obs: this.tensor(depth.near, [1, PIXELS]),
      depth_far: this.tensor(depth.far, [1, PIXELS]),
      vision_update: this.tensor([Number(this.stepIndex % FAR_INTERVAL === 0)], [1, 1]),
      ...this.encoderState,
    });
    const actor = await this.actor.run({ obs: encoder.actor_obs, ...this.actorState });
    if (!actor.actions.data.every(Number.isFinite)) throw new Error('The policy returned a non-finite action');
    this.encoderState = { h0: encoder.hn, c0: encoder.cn, far_h0: encoder.far_hn, far_c0: encoder.far_cn };
    this.actorState = { h0: actor.hn, c0: actor.cn };
    this.previousAction = actor.actions.data;
    this.stepIndex++;
    return this.previousAction;
  }
}

export function advancePhysics(mujoco, model, data, action) {
  const targets = new Float64Array(12);
  for (let lab = 0; lab < NATIVE_JOINTS.length; lab++) {
    const native = NATIVE_JOINTS[lab];
    targets[native] = clamp(DEFAULT_POSE[native % 3] + 0.25 * action[lab], -100, 100);
  }
  for (let step = 0; step < PHYSICS_STEPS; step++) {
    const velocity = data.qvel;
    const position = data.qpos;
    const control = data.ctrl;
    for (let joint = 0; joint < 12; joint++) {
      const speed = velocity[6 + joint];
      const torque = clamp(30 * (targets[joint] - position[7 + joint]) - 0.5 * speed, -48, 48);
      const calf = joint % 3 === 2;
      const corner = calf ? 8.3775804096 : 14.6607657168;
      const peak = calf ? 20.9439510239 : 26.1799387799;
      const limit = torque * speed > 0 ? 48 * clamp((peak - Math.abs(speed)) / (peak - corner), 0, 1) : 48;
      control[joint] = clamp(torque, -limit, limit);
    }
    mujoco.mj_step(model, data);
  }
  mujoco.mj_forward(model, data);
}

export function runOutcome(data, trunkId, course) {
  const position = data.qpos;
  if (![position[0], position[1], position[2], data.time].every(Number.isFinite)) {
    throw new Error('MuJoCo returned a non-finite state');
  }
  if (position[0] >= course.finish) return COURSE_COMPLETE;
  if (Math.abs(position[1]) > 1.95) return 'Left the course';
  if (position[2] < -0.4 || data.xmat[9 * trunkId + 8] < 0.25) return 'Run ended after a fall';
  if (data.time >= 12) return 'Time limit reached';
  return '';
}
