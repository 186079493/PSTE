import loadMujoco from './vendor/mujoco/mujoco.js';
import * as ort from './vendor/ort/ort.wasm.min.mjs';
import { ParkourPolicy, advancePhysics, resetRobot, runOutcome } from './controller.mjs';
import { sceneXML } from './terrain.mjs';

export async function loadEngine(read = async (file) => {
  const response = await fetch(file);
  if (!response.ok) throw new Error(`Could not load ${file.pathname.split('/').pop()} (${response.status})`);
  return response.arrayBuffer();
}) {
  const asset = (path) => read(new URL(path, import.meta.url));
  ort.env.wasm.numThreads = 1;
  const options = { executionProviders: ['wasm'] };
  const [mujoco, xml, encoderBuffer, actorBuffer] = await Promise.all([
    loadMujoco(),
    asset('./models/robot-a.xml'),
    asset('./models/encoder.onnx'),
    asset('./models/actor.onnx'),
  ]);
  const encoder = await ort.InferenceSession.create(new Uint8Array(encoderBuffer), options);
  const actor = await ort.InferenceSession.create(new Uint8Array(actorBuffer), options);
  return new Engine(mujoco, new TextDecoder().decode(xml), new ParkourPolicy(ort, encoder, actor));
}

class Engine {
  constructor(mujoco, robot, policy) {
    this.mujoco = mujoco;
    this.robot = robot;
    this.policy = policy;
  }

  reset(course = this.course) {
    const { mujoco } = this;
    if (this.model && course === this.course) {
      mujoco.mj_resetData(this.model, this.data);
    } else {
      this.loadCourse(course);
    }
    resetRobot(this.data);
    this.policy.reset();
    mujoco.mj_forward(this.model, this.data);
  }

  loadCourse(course) {
    const { mujoco } = this;
    const model = mujoco.MjModel.from_xml_string(sceneXML(this.robot, course));
    const data = new mujoco.MjData(model);
    for (const handle of [this.data, this.model]) handle?.delete();
    this.course = course;
    this.model = model;
    this.data = data;
    this.trunkId = this.bodyId('trunk');
    this.cameraId = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_CAMERA.value, 'depth_cam');
    if (this.trunkId < 0 || this.cameraId < 0 || model.nq !== 19 || model.nv !== 18 || model.nu !== 12) {
      throw new Error('Unexpected RobotA model dimensions');
    }
  }

  bodyId(name) {
    return this.mujoco.mj_name2id(this.model, this.mujoco.mjtObj.mjOBJ_BODY.value, name);
  }

  async step() {
    const { mujoco, model, data, trunkId, cameraId, course } = this;
    const action = await this.policy.infer(data, trunkId, cameraId, course);
    advancePhysics(mujoco, model, data, action);
    return runOutcome(data, trunkId, course);
  }
}
