import { makeCourse } from './terrain.mjs';
import { COURSE_COMPLETE, POLICY_DT } from './controller.mjs';

const RESTART_DELAY_MS = 1500;

const demo = document.querySelector('[data-sim]');
const get = (selector) => demo.querySelector(selector);
const terrain = get('#terrain');
const play = get('[data-play]');
const reset = get('[data-reset]');
const view = get('[data-view]');
const status = get('[data-status]');
const description = get('[data-course]');
const placeholder = get('[data-placeholder]');
const speed = get('[data-speed]');
const clock = get('[data-time]');
const average = get('[data-average]');

let engine;
let viewer;
let timedStart;
let busy = false;
let playing = false;
let outcome = '';
let timer;
let nextStep;
let inFlight = Promise.resolve();

function updateControls() {
  terrain.disabled = busy;
  play.disabled = busy;
  reset.disabled = busy || !engine;
  view.disabled = !viewer;
  if (playing) play.textContent = 'Pause';
  else if (outcome) play.textContent = 'Run again';
  else if (engine?.data.time > 0) play.textContent = 'Resume';
  else play.textContent = 'Start simulation';
}

function readout() {
  speed.textContent = `${engine.data.qvel[0].toFixed(2)} m/s`;
  clock.textContent = timedStart === undefined ? '—' : `${(engine.data.time - timedStart).toFixed(2)} s`;
}

function stop() {
  playing = false;
  clearTimeout(timer);
}

function fail(error) {
  stop();
  outcome = 'error';
  status.textContent = `Simulation error. ${error.message || String(error)}`;
  console.error(error);
  updateControls();
}

function schedule() {
  timer = setTimeout(() => {
    inFlight = step();
  }, Math.max(0, nextStep - performance.now()));
}

function clearRunReadout() {
  timedStart = undefined;
  average.textContent = '—';
  outcome = '';
  readout();
}

function restartCourse() {
  try {
    engine.reset();
    viewer.update(engine);
    clearRunReadout();
    resume();
  } catch (error) {
    fail(error);
  }
}

async function step() {
  if (!playing) return;
  try {
    const previousPosition = engine.data.qpos[0];
    const previousTime = engine.data.time;
    outcome = await engine.step();
    const { data, course } = engine;
    const position = data.qpos[0];
    if (timedStart === undefined && previousPosition < course.firstObstacle && position >= course.firstObstacle) {
      const fraction = (course.firstObstacle - previousPosition) / (position - previousPosition);
      timedStart = previousTime + fraction * (data.time - previousTime);
    }
    viewer.update(engine);
    readout();
    if (outcome) {
      if (timedStart !== undefined && data.time > timedStart) {
        average.textContent = `${((position - course.firstObstacle) / (data.time - timedStart)).toFixed(2)} m/s`;
      }
      if (outcome === COURSE_COMPLETE && playing) {
        status.textContent = `${outcome}. Restarting…`;
        timer = setTimeout(restartCourse, RESTART_DELAY_MS);
        return;
      }
      stop();
      status.textContent = outcome;
      updateControls();
    } else if (playing) {
      nextStep = Math.max(nextStep + POLICY_DT * 1000, performance.now());
      schedule();
    }
  } catch (error) {
    fail(error);
  }
}

async function prepare(start) {
  if (busy) return;
  stop();
  busy = true;
  updateControls();
  const course = makeCourse(terrain.value);
  description.textContent = course.description;
  try {
    await inFlight;
    if (!engine) {
      status.textContent = 'Loading MuJoCo, the RobotA model, and policy weights…';
      placeholder.firstElementChild.textContent = 'Loading the physics engine, RobotA model, and policy…';
      const [{ loadEngine }, { Viewer }] = await Promise.all([import('./engine.mjs'), import('./viewer.mjs')]);
      const [loaded, robot] = await Promise.all([loadEngine(), Viewer.loadRobot()]);
      loaded.reset(course);
      viewer = new Viewer(get('[data-viewport]'), robot);
      engine = loaded;
      placeholder.hidden = true;
    } else {
      engine.reset(course);
    }
    viewer.setCourse(engine);
    clearRunReadout();
    status.textContent = 'Ready';
    if (start) resume();
  } catch (error) {
    placeholder.firstElementChild.textContent = 'The simulation could not start.';
    fail(error);
  } finally {
    busy = false;
    updateControls();
  }
}

function resume() {
  playing = true;
  nextStep = performance.now();
  status.textContent = 'Running';
  schedule();
  updateControls();
}

play.addEventListener('click', async () => {
  if (playing) {
    stop();
    status.textContent = 'Paused';
    updateControls();
  } else if (!engine || outcome) {
    await prepare(true);
  } else {
    await inFlight;
    if (!busy && !playing && !outcome) resume();
  }
});
reset.addEventListener('click', () => prepare(false));
view.addEventListener('click', () => viewer.changeView());
terrain.addEventListener('change', () => {
  description.textContent = makeCourse(terrain.value).description;
  if (engine) prepare(false);
});

const autoStart = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  autoStart.disconnect();
  if (!engine && !busy && !outcome) prepare(true);
}, { threshold: 0.1 });
autoStart.observe(get('.sim-stage'));
