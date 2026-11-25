import * as THREE from './vendor/three/three.module.min.js';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';

const COLORS = { ground: 0x4a6488, stairs: 0x577ca2, platform: 0x1b918c, gap: 0x152e49 };
const POSES = [
  { azimuth: -1.02, elevation: 0.54, radius: 3.9, ahead: 0.7 },
  { azimuth: 1.55, elevation: 0.23, radius: 3.2, ahead: 0.25 },
  { azimuth: -0.58, elevation: 0.94, radius: 6.1, ahead: 2.1 },
];

export class Viewer {
  static async loadRobot() {
    const url = new URL('./models/robot-a-visual.glb', import.meta.url);
    const { scene } = await new GLTFLoader().loadAsync(url.href);
    return scene;
  }

  constructor(element, robot) {
    this.parts = [];
    robot.traverse((part) => {
      if (part.isMesh) this.parts.push(part);
    });
    this.trunk = robot.getObjectByName('trunk');
    if (!this.trunk?.isMesh || this.parts.length !== 13) throw new Error('The RobotA visual model is missing links');

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    element.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x112237);
    this.scene.fog = new THREE.Fog(0x112237, 8, 28);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.035, 60);
    this.focus = new THREE.Vector3();
    this.scene.add(new THREE.HemisphereLight(0xe9f4ff, 0x607391, 2.45));
    const key = new THREE.DirectionalLight(0xffedd7, 2.6);
    key.position.set(-3, 8, 5);
    this.scene.add(key);

    this.courseGroup = new THREE.Group();
    this.scene.add(this.courseGroup, robot);

    this.viewIndex = 0;
    this.changeView(0);
    const canvas = this.renderer.domElement;
    let pointer;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      pointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!pointer || !event.isPrimary) return;
      this.azimuth -= (event.clientX - pointer.x) * 0.008;
      this.elevation = THREE.MathUtils.clamp(this.elevation + (event.clientY - pointer.y) * 0.006, 0.1, 1.46);
      pointer = { x: event.clientX, y: event.clientY };
      this.render();
    });
    canvas.addEventListener('lostpointercapture', () => {
      pointer = null;
      canvas.classList.remove('dragging');
    });
    new ResizeObserver(() => {
      const { clientWidth, clientHeight } = element;
      if (!clientWidth || !clientHeight) return;
      this.camera.aspect = clientWidth / clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(clientWidth, clientHeight);
      this.render();
    }).observe(element);
  }

  changeView(index = (this.viewIndex + 1) % POSES.length) {
    this.viewIndex = index;
    Object.assign(this, POSES[index]);
    this.render();
  }

  setCourse(engine) {
    this.courseGroup.traverse((item) => {
      item.geometry?.dispose();
      item.material?.dispose();
    });
    this.courseGroup.clear();
    for (const box of engine.course.boxes) {
      const { begin, end, bottom, top, width, style } = box;
      const geometry = new THREE.BoxGeometry(end - begin, top - bottom, width);
      const tile = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS[style], roughness: 0.9 }));
      tile.position.set((begin + end) / 2, (top + bottom) / 2, 0);
      tile.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({
        color: style === 'gap' ? 0x264661 : 0x91b0cf, opacity: 0.38, transparent: true,
      })));
      this.courseGroup.add(tile);
      if (style !== 'gap' && end - begin > 0.31) {
        const vertices = [];
        for (let x = Math.ceil(begin); x < end; x++) vertices.push(x, top + 0.005, -width / 2, x, top + 0.005, width / 2);
        vertices.push(begin, top + 0.005, 0, end, top + 0.005, 0);
        const lines = new THREE.BufferGeometry();
        lines.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        this.courseGroup.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({
          color: 0xbddef9, opacity: 0.2, transparent: true,
        })));
      }
    }
    this.bodyIds = this.parts.map((part) => {
      const id = engine.bodyId(part.name);
      if (id < 0) throw new Error(`No MuJoCo body matches the RobotA link ${part.name}`);
      return id;
    });
    this.update(engine);
  }

  update({ data }) {
    const positions = data.xpos;
    const rotations = data.xquat;
    for (let index = 0; index < this.parts.length; index++) {
      const part = this.parts[index];
      const position = 3 * this.bodyIds[index];
      const rotation = 4 * this.bodyIds[index];
      // Convert MuJoCo's Z-up frame and wxyz quaternions to Three.js's Y-up frame and xyzw.
      part.position.set(positions[position], positions[position + 2], -positions[position + 1]);
      part.quaternion.set(rotations[rotation + 1], rotations[rotation + 3], -rotations[rotation + 2], rotations[rotation]);
    }
    this.render();
  }

  render() {
    this.focus.copy(this.trunk.position);
    this.focus.x += this.ahead;
    const flat = this.radius * Math.cos(this.elevation);
    this.camera.position.set(
      this.focus.x + flat * Math.cos(this.azimuth),
      this.focus.y + this.radius * Math.sin(this.elevation),
      this.focus.z + flat * Math.sin(this.azimuth),
    );
    this.camera.lookAt(this.focus);
    this.renderer.render(this.scene, this.camera);
  }
}
