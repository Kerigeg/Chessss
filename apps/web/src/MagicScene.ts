import * as THREE from "three";
import type { ChessColor, MoveView } from "@chessss/shared";
import { animatedOrigins, readPosition, skins, type Loadout, type Skin } from "./magicState";

const point = (square: string) => new THREE.Vector3(square.charCodeAt(0) - 100.5, 0, 4.5 - Number(square[1]));
const colorOf = (piece: string): ChessColor => piece === piece.toUpperCase() ? "white" : "black";
const material = (color: string | number, metalness = .25, roughness = .35) => new THREE.MeshStandardMaterial({ color, metalness, roughness });

/** Local procedural models: six silhouettes, with different geometry for each collection. */
export function pieceModel(symbol: string, skin: Skin): THREE.Group {
  const group = new THREE.Group();
  const side = colorOf(symbol);
  const palette = skins[skin];
  const body = material(palette[side], skin === "sovereign" ? .65 : .28, skin === "astral" ? .2 : .38);
  const dark = material(side === "white" ? "#d4e3e8" : "#24243c", .65, .3);
  const glow = new THREE.MeshStandardMaterial({ color: palette[side], emissive: palette[side], emissiveIntensity: 1.3, metalness: .4, roughness: .2 });
  const gold = material(skin === "sovereign" ? "#e6b66b" : palette[side], .65, .28);
  const sides = skin === "astral" ? 6 : skin === "neon" ? 4 : 24;
  function add(geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  }
  function cylinder(top: number, bottom: number, height: number, y: number, mat = body) {
    return add(new THREE.CylinderGeometry(top, bottom, height, sides), mat, 0, y, 0);
  }
  cylinder(.31, .35, .12, .08, dark);
  cylinder(.30, .32, .065, .17, gold);
  cylinder(.23, .29, .11, .24);
  const kind = symbol.toLowerCase();
  const height = kind === "p" ? .46 : kind === "r" ? .57 : .72;
  cylinder(.13, .24, height, .29 + height / 2);
  cylinder(.21, .15, .09, .3 + height, gold);
  const top = .39 + height;
  if (kind === "p") {
    add(skin === "astral" ? new THREE.OctahedronGeometry(.23) : new THREE.SphereGeometry(.20, sides, 10), body, 0, top + .12, 0);
  } else if (kind === "r") {
    cylinder(.29, .23, .20, top + .04, dark);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      add(new THREE.BoxGeometry(.17, .20, .17), body, Math.sin(a) * .22, top + .20, Math.cos(a) * .22);
    }
    cylinder(.12, .12, .07, top + .16, glow);
  } else if (kind === "n") {
    // Extruded horse head with ears, muzzle, and a contrasting mane.
    const shape = new THREE.Shape();
    shape.moveTo(-.21, 0); shape.lineTo(-.23, .33); shape.lineTo(-.09, .63); shape.lineTo(.02, .50);
    shape.lineTo(.14, .55); shape.lineTo(.18, .35); shape.lineTo(.39, .20); shape.lineTo(.35, .04);
    shape.lineTo(.12, .10); shape.lineTo(.08, -.1); shape.closePath();
    const head = add(new THREE.ExtrudeGeometry(shape, { depth: .19, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 1, steps: 1 }), body, -.05, top - .08, -.095);
    if (side === "black") head.rotation.y = Math.PI;
    add(new THREE.BoxGeometry(.1, .44, .24), dark, side === "white" ? -.23 : .13, top + .12, 0);
    add(new THREE.SphereGeometry(.035, 8, 6), glow, side === "white" ? .08 : -.18, top + .27, .13);
    add(new THREE.SphereGeometry(.035, 8, 6), glow, side === "white" ? .08 : -.18, top + .27, -.13);
  } else if (kind === "b") {
    const gem = add(new THREE.OctahedronGeometry(.27), body, 0, top + .20, 0); gem.scale.y = 1.5;
    const slash = add(new THREE.BoxGeometry(.055, .30, .38), dark, .04, top + .35, 0); slash.rotation.z = -.4;
    add(new THREE.SphereGeometry(.065, 8, 8), glow, 0, top + .62, 0);
  } else if (kind === "q") {
    cylinder(.27, .13, .23, top + .09, gold);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      add(new THREE.ConeGeometry(.07, .27, sides), body, Math.sin(a) * .22, top + .33, Math.cos(a) * .22);
      add(new THREE.SphereGeometry(.055, 8, 6), glow, Math.sin(a) * .22, top + .48, Math.cos(a) * .22);
    }
    add(new THREE.OctahedronGeometry(.12), glow, 0, top + .33, 0);
  } else if (kind === "k") {
    cylinder(.24, .18, .18, top + .06, gold);
    add(new THREE.BoxGeometry(.105, .44, .105), body, 0, top + .37, 0);
    add(new THREE.BoxGeometry(.34, .095, .105), body, 0, top + .43, 0);
    add(new THREE.OctahedronGeometry(.075), glow, 0, top + .64, 0);
  }
  if (skin === "astral") {
    for (let i = 0; i < 3; i++) {
      const crystal = add(new THREE.OctahedronGeometry(.08), glow, Math.cos(i * 2.1) * .24, .38, Math.sin(i * 2.1) * .24); crystal.scale.y = 2;
    }
  } else if (skin === "neon") {
    cylinder(.17, .20, .06, .50, glow);
    for (const sign of [-1, 1]) add(new THREE.BoxGeometry(.10, .35, .22), dark, sign * .21, .43, 0);
  } else {
    cylinder(.17, .20, .035, .49, gold);
    for (let i = 0; i < 8; i++) add(new THREE.SphereGeometry(.028, 6, 4), gold, Math.sin(i * Math.PI / 4) * .28, .25, Math.cos(i * Math.PI / 4) * .28);
  }
  group.scale.setScalar(.88);
  return group;
}

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
  root.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Points) {
      geometries.add(node.geometry);
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) materials.add(mat);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => {
    if (m instanceof THREE.MeshBasicMaterial) m.map?.dispose();
    m.dispose();
  });
  root.traverse(node => { if (node instanceof THREE.DirectionalLight) node.shadow.dispose(); });
}

type Motion = { trail: THREE.Mesh[]; object: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; start: number; capture: boolean; color: string };
type Burst = { group: THREE.Group; start: number; capture: boolean };
export class MagicScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-7, 7, 7, -7, .1, 100);
  private models = new THREE.Group();
  private markers = new THREE.Group();
  private tiles: THREE.Mesh[] = [];
  private motions: Motion[] = [];
  private bursts: Burst[] = [];
  private fen: string | null = null;
  private loadout = "";
  private frame = 0;
  private observer: ResizeObserver;
  private reduced = false;
  private stars: THREE.Points;
  private lastTime = 0;
  private view: ChessColor;

  constructor(private host: HTMLElement, view: ChessColor, private onSquare: (square: string) => void, private onFailure: () => void) {
    this.view = view;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    const canvas = this.renderer.domElement;
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
    canvas.addEventListener("pointerup", this.pick);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    this.scene.add(new THREE.HemisphereLight("#cfddff", "#1c1430", 2.4));
    const sun = new THREE.DirectionalLight("#fff1d9", 4.2); sun.position.set(-3, 10, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -7; sun.shadow.camera.right = 7; sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7; sun.shadow.bias = -.001; sun.shadow.normalBias = .035;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight("#9280ff", 3.3); rim.position.set(5, 4, -6); this.scene.add(rim);
    const add = (geometry: THREE.BufferGeometry, mat: THREE.Material, y: number) => { const m = new THREE.Mesh(geometry, mat); m.position.y = y; m.receiveShadow = true; this.scene.add(m); return m; };
    add(new THREE.BoxGeometry(8.7, .36, 8.7), material("#18182b", .7), -.30);
    add(new THREE.BoxGeometry(8.56, .035, 8.56), new THREE.MeshStandardMaterial({ color: "#948cc2", emissive: "#8070b4", emissiveIntensity: .7, metalness: .6 }), -.105);
    add(new THREE.BoxGeometry(8.4, .12, 8.4), material("#232536", .6), -.045);
    for (let rank = 1; rank <= 8; rank++) for (let file = 0; file < 8; file++) {
      const square = `${"abcdefgh"[file]}${rank}`;
      const tile = new THREE.Mesh(new THREE.BoxGeometry(.986, .065, .986), material((file + rank) % 2 ? "#929da9" : "#343849", .35, .48));
      tile.position.copy(point(square)); tile.receiveShadow = true; tile.userData.square = square; this.tiles.push(tile); this.scene.add(tile);
    }
    const label = (text: string, x: number, z: number) => {
      const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
      const context = canvas.getContext("2d"); if (!context) return;
      context.fillStyle = "#c4bbd7"; context.font = "32px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, 32, 32);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.28, .28), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = view === "black" ? Math.PI : 0; mesh.position.set(x, .025, z); this.scene.add(mesh);
    };
    for (let i = 0; i < 8; i++) { label("abcdefgh"[i], i - 3.5, view === "white" ? 4.16 : -4.16); label(String(8 - i), view === "white" ? -4.16 : 4.16, i - 3.5); }
    const halo = add(new THREE.RingGeometry(6.25, 6.28, 128), new THREE.MeshBasicMaterial({ color: "#79719c", transparent: true, opacity: .32, side: THREE.DoubleSide }), -.8); halo.rotation.x = -Math.PI / 2;
    const halo2 = add(new THREE.RingGeometry(6.45, 6.46, 128), new THREE.MeshBasicMaterial({ color: "#79719c", transparent: true, opacity: .20, side: THREE.DoubleSide }), -.8); halo2.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 48; i++) {
      const a = i * Math.PI / 24;
      const rune = add(new THREE.BoxGeometry(.018, .015, i % 4 === 0 ? .25 : .09), new THREE.MeshBasicMaterial({ color: "#80729d" }), -.79);
      rune.position.set(Math.sin(a) * 6.37, -.79, Math.cos(a) * 6.37); rune.rotation.y = a;
    }
    const positions = new Float32Array(100 * 3);
    for (let i = 0; i < 100; i++) { positions[i * 3] = Math.sin(i * 73.13) * 11; positions[i * 3 + 1] = Math.cos(i * 38.7) * 3; positions[i * 3 + 2] = Math.cos(i * 19.73) * 10; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: "#b9abe8", size: .028, transparent: true, opacity: .5 })); this.scene.add(this.stars);
    this.scene.add(this.models, this.markers);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    this.frame = requestAnimationFrame(this.animate);
  }
  private contextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(this.frame); this.onFailure(); };
  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const aspect = w / h; const half = Math.max(5.9, 6.6 / aspect);
    this.camera.left = -half * aspect; this.camera.right = half * aspect; this.camera.top = half; this.camera.bottom = -half;
    const sign = this.view === "white" ? 1 : -1;
    this.camera.position.set(3.5 * sign, 11.8, 10.8 * sign); this.camera.lookAt(0, .15, 0); this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
  private pick = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const hit = ray.intersectObjects([...this.models.children, ...this.tiles], true)[0];
    let object: THREE.Object3D | null = hit?.object ?? null;
    while (object && !object.userData.square) object = object.parent;
    if (object?.userData.square) this.onSquare(object.userData.square);
  };
  update(fen: string, move: MoveView | null, loadout: Loadout, reduced: boolean) {
    this.reduced = reduced;
    const key = JSON.stringify(loadout);
    if (fen === this.fen && key === this.loadout) return;
    const origins = reduced || key !== this.loadout ? new Map<string, string>() : animatedOrigins(this.fen, fen, move);
    this.motions.forEach(m => m.trail.forEach(spark => { this.scene.remove(spark); disposeTree(spark); }));
    this.motions = []; this.bursts.forEach(b => { this.scene.remove(b.group); disposeTree(b.group); }); this.bursts = [];
    disposeTree(this.models); this.models.clear();
    for (const [square, symbol] of readPosition(fen)) {
      const object = pieceModel(symbol, loadout[colorOf(symbol)]); object.userData.square = square;
      const to = point(square); object.position.copy(to); this.models.add(object);
      const origin = origins.get(square);
      if (origin) {
        const from = point(origin); object.position.copy(from);
        const color = skins[loadout[colorOf(symbol)]][colorOf(symbol)];
        const trail = Array.from({ length: 9 }, (_, i) => {
          const spark = new THREE.Mesh(new THREE.SphereGeometry(.065 - i * .005, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .7 - i * .06, depthWrite: false }));
          spark.position.copy(from); this.scene.add(spark); return spark;
        });
        this.motions.push({ trail, object, from, to, start: performance.now(), capture: Boolean(move?.captured && square === move.to), color: skins[loadout[colorOf(symbol)]][colorOf(symbol)] });
      }
    }
    this.fen = fen; this.loadout = key;
  }
  highlight(selected: string | null, targets: string[], lastMove: MoveView | null, checkSquare: string | null, focused: string | null) {
    disposeTree(this.markers); this.markers.clear();
    const ring = (square: string, color: string, inner: number, outer: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.copy(point(square)); m.position.y = .05; this.markers.add(m);
    };
    if (lastMove) { ring(lastMove.from, "#cab286", .36, .39); ring(lastMove.to, "#cab286", .36, .39); }
    targets.forEach(square => ring(square, "#9af3e3", .08, .14));
    if (selected) ring(selected, "#aaffee", .40, .46);
    if (focused && focused !== selected) ring(focused, "#ffffff", .42, .45);
    if (checkSquare) ring(checkSquare, "#ff537a", .31, .47);
  }
  private burst(motion: Motion, now: number) {
    const group = new THREE.Group(); group.position.copy(motion.to); group.position.y = .1;
    const mat = new THREE.MeshBasicMaterial({ color: motion.capture ? "#ffbbad" : motion.color, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(.28, .34, 48), mat); ring.rotation.x = -Math.PI / 2; group.add(ring);
    for (let i = 0; i < (motion.capture ? 22 : 10); i++) {
      const spark = new THREE.Mesh(new THREE.OctahedronGeometry(motion.capture ? .075 : .04), mat); const a = i * 2.4;
      spark.userData.velocity = new THREE.Vector3(Math.sin(a), .25 + (i % 5) * .24, Math.cos(a)); group.add(spark);
    }
    this.scene.add(group); this.bursts.push({ group, start: now, capture: motion.capture });
  }
  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate);
    if (document.hidden || now - this.lastTime < 1000 / 45) return;
    this.lastTime = now;
    this.motions = this.motions.filter(motion => {
      const t = Math.min(1, (now - motion.start) / (this.reduced ? 1 : 540)); const ease = t * t * (3 - 2 * t);
      motion.object.position.lerpVectors(motion.from, motion.to, ease); motion.object.position.y = Math.sin(t * Math.PI) * .75;
      motion.trail.forEach((spark, index) => {
        const lag = Math.max(0, t - (index + 1) * .045); const eased = lag * lag * (3 - 2 * lag);
        spark.position.lerpVectors(motion.from, motion.to, eased); spark.position.y = .3 + Math.sin(lag * Math.PI) * .75;
      });
      if (t === 1) { motion.trail.forEach(spark => { this.scene.remove(spark); disposeTree(spark); }); if (!this.reduced) this.burst(motion, now); return false; }
      return true;
    });
    this.bursts = this.bursts.filter(burst => {
      const t = (now - burst.start) / 800;
      if (t > 1 || this.reduced) { this.scene.remove(burst.group); disposeTree(burst.group); return false; }
      burst.group.children.forEach((child, i) => {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
        if (i === 0) mesh.scale.setScalar(1 + t * (burst.capture ? 4 : 2));
        else { mesh.position.copy(mesh.userData.velocity).multiplyScalar(t * (burst.capture ? 1.9 : .9)); mesh.position.y -= t * t * .5; mesh.rotation.y = t * 5; }
        mesh.material.opacity = (1 - t) * .85;
      }); return true;
    });
    if (!this.reduced) this.stars.rotation.y = now * .000012;
    try { this.renderer.render(this.scene, this.camera); }
    catch { cancelAnimationFrame(this.frame); this.onFailure(); }
  };
  dispose() {
    cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.renderer.domElement.removeEventListener("pointerup", this.pick); this.renderer.domElement.removeEventListener("webglcontextlost", this.contextLost);
    disposeTree(this.scene); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
