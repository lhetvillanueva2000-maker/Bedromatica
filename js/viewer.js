/**
 * Voxel hologram.
 *
 * Two instanced meshes: solid for blocks you are keeping, translucent for
 * blocks marked as clutter. Keeping the removed blocks on screen as ghosts is
 * the point of the view - you can see the build separating from the ground it
 * was cut out of, and catch the case where a filter is about to eat a wall.
 *
 * Camera controls are hand-written rather than pulled from three's examples,
 * because those ship as ES modules that do not pair with the UMD build, and
 * because touch needs different handling than a desktop-first control does.
 */

import { blockColor, isThin } from "./blocks.js";

const UP = 0.999;

export class Hologram {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);

    this.target = new THREE.Vector3();
    this.spherical = { radius: 40, theta: Math.PI * 0.25, phi: Math.PI * 0.32 };

    this.scene.add(new THREE.AmbientLight(0xbcd6f0, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(0.6, 1, 0.45);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ce0ec, 0.35);
    rim.position.set(-0.7, 0.35, -0.6);
    this.scene.add(rim);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.grid = null;
    this.solid = null;
    this.ghost = null;
    this.fitSize = null;
    this.userAdjusted = false;

    this.bindControls();
    this.resize();

    this.running = true;
    this.needsRender = true;
    this.loop();
  }

  /* ---------------------------------------------------------------- *
   * Scene building
   * ---------------------------------------------------------------- */

  /**
   * @param {Array<{x,y,z,name,kept}>} cells
   * @param {[number,number,number]} size
   */
  setCells(cells, size) {
    this.clear();
    if (!cells.length) {
      this.needsRender = true;
      return;
    }

    const kept = cells.filter((c) => c.kept);
    const dropped = cells.filter((c) => !c.kept);

    this.solid = this.buildMesh(kept, false);
    this.ghost = this.buildMesh(dropped, true);
    if (this.solid) this.group.add(this.solid);
    if (this.ghost) this.group.add(this.ghost);

    const [sx, sy, sz] = size;
    this.group.position.set(-sx / 2, -sy / 2, -sz / 2);

    this.grid = new THREE.GridHelper(
      Math.max(sx, sz) * 1.6,
      Math.max(2, Math.round(Math.max(sx, sz) / 2)),
      0x2c8aa4,
      0x1d375e
    );
    this.grid.position.y = -sy / 2 - 0.02;
    this.scene.add(this.grid);

    this.frame(size);
    this.needsRender = true;
  }

  buildMesh(cells, isGhost) {
    if (!cells.length) return null;

    const geometry = new THREE.BoxGeometry(1, 1, 1);

    // Per-instance colour needs BOTH halves of the shader path: `vertexColors`
    // turns on USE_COLOR, which multiplies by the geometry's `color` attribute.
    // BoxGeometry has no such attribute, so without this white one every
    // instance multiplies down to black.
    if (!isGhost) {
      const white = new Float32Array(geometry.attributes.position.count * 3).fill(1);
      geometry.setAttribute("color", new THREE.BufferAttribute(white, 3));
    }

    const material = new THREE.MeshLambertMaterial(
      isGhost
        ? {
            color: 0x8fb8d8,
            transparent: true,
            opacity: 0.16,
            depthWrite: false
          }
        : { vertexColors: true }
    );

    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const thin = isThin(cell.name);
      scale.set(1, thin ? 0.14 : 1, 1);
      position.set(
        cell.x + 0.5,
        cell.y + (thin ? 0.07 : 0.5),
        cell.z + 0.5
      );
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      if (!isGhost) {
        color.setHex(blockColor(cell.name));
        mesh.setColorAt(i, color);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = isGhost ? 1 : 0;
    return mesh;
  }

  clear() {
    for (const mesh of [this.solid, this.ghost]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.solid = null;
    this.ghost = null;
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
      this.grid = null;
    }
  }

  /**
   * Pulls the camera back far enough to hold the whole structure.
   *
   * Fits the bounding sphere against BOTH axes: on a phone held upright the
   * horizontal field of view is much narrower than the vertical one, so fitting
   * only to the vertical FOV puts the camera inside a wide build.
   */
  frame(size) {
    this.fitSize = size;
    this.userAdjusted = false;

    const [sx, sy, sz] = size;
    const radius = 0.5 * Math.hypot(sx, sy, sz);
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;

    const distV = radius / Math.sin(fov / 2);
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const distH = radius / Math.sin(hFov / 2);

    this.target.set(0, 0, 0);
    this.spherical.radius = Math.max(distV, distH) * 1.18;
    this.spherical.theta = Math.PI * 0.25;
    this.spherical.phi = Math.PI * 0.32;
    this.applyCamera();
  }

  /* ---------------------------------------------------------------- *
   * Controls
   * ---------------------------------------------------------------- */

  bindControls() {
    const el = this.canvas;
    let mode = null;
    let last = null;
    let lastPinch = 0;

    const pointFrom = (e) => ({ x: e.clientX, y: e.clientY });
    const touchMid = (t) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2
    });
    const touchGap = (t) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return; // touch handled below
      el.setPointerCapture(e.pointerId);
      mode = e.button === 2 || e.shiftKey ? "pan" : "orbit";
      last = pointFrom(e);
    });

    el.addEventListener("pointermove", (e) => {
      if (!mode || !last || e.pointerType === "touch") return;
      const now = pointFrom(e);
      this.drag(mode, now.x - last.x, now.y - last.y);
      last = now;
    });

    const endPointer = (e) => {
      if (e.pointerType === "touch") return;
      mode = null;
      last = null;
    };
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false }
    );

    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (e.touches.length === 1) {
          mode = "orbit";
          last = pointFrom(e.touches[0]);
        } else if (e.touches.length === 2) {
          mode = "pinch";
          last = touchMid(e.touches);
          lastPinch = touchGap(e.touches);
        }
      },
      { passive: false }
    );

    el.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        if (mode === "orbit" && e.touches.length === 1) {
          const now = pointFrom(e.touches[0]);
          this.drag("orbit", now.x - last.x, now.y - last.y);
          last = now;
        } else if (mode === "pinch" && e.touches.length === 2) {
          const gap = touchGap(e.touches);
          if (lastPinch > 0) this.zoom(lastPinch / gap);
          lastPinch = gap;

          const mid = touchMid(e.touches);
          this.drag("pan", mid.x - last.x, mid.y - last.y);
          last = mid;
        }
      },
      { passive: false }
    );

    const endTouch = (e) => {
      e.preventDefault();
      mode = null;
      last = null;
      lastPinch = 0;
    };
    el.addEventListener("touchend", endTouch, { passive: false });
    el.addEventListener("touchcancel", endTouch, { passive: false });
  }

  drag(mode, dx, dy) {
    this.userAdjusted = true;
    if (mode === "orbit") {
      this.spherical.theta -= dx * 0.006;
      this.spherical.phi = clamp(this.spherical.phi - dy * 0.006, 0.02, Math.PI - 0.02);
    } else {
      const scale = this.spherical.radius * 0.0016;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      this.target.addScaledVector(right, -dx * scale);
      this.target.addScaledVector(up, dy * scale);
    }
    this.applyCamera();
  }

  zoom(factor) {
    this.userAdjusted = true;
    this.spherical.radius = clamp(this.spherical.radius * factor, 2, 3000);
    this.applyCamera();
  }

  applyCamera() {
    const { radius, theta, phi } = this.spherical;
    const sinPhi = Math.sin(phi);
    this.camera.position.set(
      this.target.x + radius * sinPhi * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * sinPhi * Math.cos(theta)
    );
    this.camera.up.set(0, UP, 0);
    this.camera.lookAt(this.target);
    this.needsRender = true;
  }

  /* ---------------------------------------------------------------- *
   * Frame loop
   * ---------------------------------------------------------------- */

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // panel is hidden; nothing to fit to

    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // A structure loaded while this panel was hidden was framed against a
    // meaningless aspect ratio. Refit now, unless the viewer has taken over.
    if (this.fitSize && !this.userAdjusted) this.frame(this.fitSize);
    this.needsRender = true;
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
