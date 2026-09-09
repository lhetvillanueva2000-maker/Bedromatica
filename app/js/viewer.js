/**
 * Voxel hologram.
 *
 * Renders every loaded structure at once, each placed at its real
 * structure_world_origin, so the view is the whole set of builds sitting where
 * they actually were rather than one structure floating alone.
 *
 * Three instanced meshes carry the blocks: solid for what you are keeping,
 * translucent for what the filter will cut, and an additive overlay for
 * anything a lever is currently powering. Entities are drawn separately with
 * their own silhouettes.
 *
 * Camera controls are hand-written rather than pulled from three's examples,
 * because those ship as ES modules that do not pair with the UMD build, and
 * because a phone needs tap, long-press and pinch to mean three different
 * things on the same surface.
 */

import { blockColor, isThin } from "./blocks.js";
import { blockDetailTexture, ghostTexture } from "./textures.js";

const TAP_MS = 260;
const HOLD_MS = 420;
const TAP_SLOP = 10;

export class Hologram {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.handlers = handlers;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      // A world-scale scene spans thousands of blocks while individual faces
      // are one block apart. A linear depth buffer cannot hold both without
      // coplanar faces tearing into each other.
      logarithmicDepthBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.sortObjects = true;

    this.scene = new THREE.Scene();
    // Near plane well off zero: pushing it out is the single biggest win
    // against z-fighting, log buffer or not.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);

    this.target = new THREE.Vector3();
    this.spherical = { radius: 40, theta: Math.PI * 0.25, phi: Math.PI * 0.32 };

    this.scene.add(new THREE.AmbientLight(0xbcd6f0, 0.66));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(0.6, 1, 0.45);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ce0ec, 0.32);
    rim.position.set(-0.7, 0.35, -0.6);
    this.scene.add(rim);

    this.detail = blockDetailTexture();
    this.ghostMap = ghostTexture();

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.solid = null;
    this.ghost = null;
    this.power = null;
    this.entityGroup = null;
    this.terrainGroup = null;
    this.grid = null;

    /** Parallel to the solid mesh's instance ids, for picking. */
    this.solidCells = [];
    this.allCells = [];

    this.fitSize = null;
    this.userAdjusted = false;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.selection = null;   // {min:{x,y,z}, max:{x,y,z}} in world cells
    this.selectionMesh = null;
    this.hoverMesh = null;

    this.mode = "orbit";

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
   * @param {Array} cells world-positioned cells: {x,y,z,name,kept,structureIndex}
   * @param {{min:number[], max:number[]}} bounds overall world bounds
   * @param {Array} entities world-positioned entities
   */
  setCells(cells, bounds, entities = []) {
    this.clear();
    this.allCells = cells;

    if (!cells.length) {
      this.needsRender = true;
      return;
    }

    const kept = cells.filter((c) => c.kept);
    const dropped = cells.filter((c) => !c.kept);

    this.solidCells = kept;
    this.solid = this.buildBlockMesh(kept, false);
    this.ghost = this.buildBlockMesh(dropped, true);
    if (this.solid) this.group.add(this.solid);
    if (this.ghost) this.group.add(this.ghost);

    if (entities.length) {
      this.entityGroup = this.buildEntities(entities);
      this.group.add(this.entityGroup);
    }

    const span = [
      bounds.max[0] - bounds.min[0] + 1,
      bounds.max[1] - bounds.min[1] + 1,
      bounds.max[2] - bounds.min[2] + 1
    ];
    this.centre = new THREE.Vector3(
      bounds.min[0] + span[0] / 2,
      bounds.min[1] + span[1] / 2,
      bounds.min[2] + span[2] / 2
    );

    this.grid = new THREE.GridHelper(
      Math.max(span[0], span[2]) * 1.5,
      Math.max(2, Math.min(60, Math.round(Math.max(span[0], span[2]) / 4))),
      0x2c8aa4,
      0x1d375e
    );
    this.grid.position.set(this.centre.x, bounds.min[1] - 0.02, this.centre.z);
    this.grid.material.depthWrite = false;
    this.scene.add(this.grid);

    this.frame(span);
    this.needsRender = true;
  }

  buildBlockMesh(cells, isGhost) {
    if (!cells.length) return null;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    // Per-instance colour needs USE_COLOR on, which multiplies by the
    // geometry's own colour attribute - BoxGeometry has none, so without this
    // white one every instance multiplies down to black.
    const white = new Float32Array(geometry.attributes.position.count * 3).fill(1);
    geometry.setAttribute("color", new THREE.BufferAttribute(white, 3));

    const material = new THREE.MeshLambertMaterial(
      isGhost
        ? {
            map: this.ghostMap,
            color: 0x8fb8d8,
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
            // Ghosts sit in the same cells as the terrain they replace; the
            // offset keeps their faces off the solids' faces.
            polygonOffset: true,
            polygonOffsetFactor: 2,
            polygonOffsetUnits: 2
          }
        : {
            map: this.detail,
            vertexColors: true,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
          }
    );

    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const thin = isThin(cell.name);
      // Thin blocks are inset rather than merely flattened, so their top face
      // never lands exactly on the face of the block underneath.
      scale.set(thin ? 0.96 : 1, thin ? 0.12 : 1, thin ? 0.96 : 1);
      position.set(
        cell.x + 0.5,
        cell.y + (thin ? 0.062 : 0.5),
        cell.z + 0.5
      );
      matrix.compose(position, quat, scale);
      mesh.setMatrixAt(i, matrix);
      if (!isGhost) {
        colour.setHex(blockColor(cell.name));
        mesh.setColorAt(i, colour);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = isGhost ? 2 : 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Item frames, armour stands, paintings - never mobs. */
  buildEntities(entities) {
    const group = new THREE.Group();
    const shapes = {
      panel: new THREE.BoxGeometry(0.9, 0.9, 0.08),
      post: new THREE.BoxGeometry(0.22, 1.7, 0.22),
      cart: new THREE.BoxGeometry(0.86, 0.5, 0.86),
      cube: new THREE.BoxGeometry(0.6, 0.6, 0.6)
    };

    const byShape = new Map();
    for (const e of entities) {
      const shape = shapes[e.shape] ? e.shape : "cube";
      if (!byShape.has(shape)) byShape.set(shape, []);
      byShape.get(shape).push(e);
    }

    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const quat = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);

    for (const [shape, list] of byShape) {
      const geometry = shapes[shape];
      const white = new Float32Array(geometry.attributes.position.count * 3).fill(1);
      geometry.setAttribute("color", new THREE.BufferAttribute(white, 3));

      const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });

      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        position.set(e.x, e.y + (shape === "post" ? 0.85 : 0.5), e.z);
        quat.setFromAxisAngle(axis, (-(e.yaw ?? 0) * Math.PI) / 180);
        matrix.compose(position, quat, scale);
        mesh.setMatrixAt(i, matrix);
        colour.setHex(e.color);
        mesh.setColorAt(i, colour);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    return group;
  }

  /**
   * Terrain, as typed arrays straight from the worker.
   *
   * Split into 64x64 tiles rather than one giant InstancedMesh, because an
   * InstancedMesh's bounding sphere comes from its geometry, not from where its
   * instances actually sit. One mesh spanning a whole world therefore has a
   * one-block bounding sphere and either never culls or culls wrongly; per-tile
   * meshes each get a true bound, so frustum culling can be switched on and the
   * GPU skips everything off screen.
   *
   * @param {{count:number, names:string[], x:Int32Array, y:Int32Array, z:Int32Array, id:Uint16Array}} cells
   */
  setTerrain(cells) {
    this.clearTerrain();
    if (!cells || !cells.count) return 0;

    const TILE = 64;
    const tiles = new Map();
    for (let i = 0; i < cells.count; i++) {
      const key = `${Math.floor(cells.x[i] / TILE)},${Math.floor(cells.z[i] / TILE)}`;
      let list = tiles.get(key);
      if (!list) tiles.set(key, (list = []));
      list.push(i);
    }

    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const white = new Float32Array(geometry.attributes.position.count * 3).fill(1);
    geometry.setAttribute("color", new THREE.BufferAttribute(white, 3));

    const material = new THREE.MeshLambertMaterial({
      map: this.detail,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });

    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const quat = new THREE.Quaternion();

    // Colour is looked up once per distinct block name, not once per cell.
    const palette = cells.names.map((n) => new THREE.Color(blockColor(n)));

    for (const indices of tiles.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, indices.length);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (let n = 0; n < indices.length; n++) {
        const i = indices[n];
        const x = cells.x[i] + 0.5;
        const y = cells.y[i] + 0.5;
        const z = cells.z[i] + 0.5;
        position.set(x, y, z);
        matrix.compose(position, quat, scale);
        mesh.setMatrixAt(n, matrix);
        colour.copy(palette[cells.id[i]] ?? palette[0]);
        mesh.setColorAt(n, colour);

        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // A real bound for this tile, so culling can be trusted.
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      mesh.geometry = geometry;
      mesh.boundingSphereOverride = new THREE.Sphere(
        new THREE.Vector3(cx, cy, cz),
        0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) + 1
      );
      mesh.frustumCulled = false;
      mesh.userData.bounds = mesh.boundingSphereOverride;
      mesh.renderOrder = -1;
      group.add(mesh);
    }

    this.terrainGroup = group;
    this.terrainTiles = [...group.children];
    this.scene.add(group);
    this.needsRender = true;
    return cells.count;
  }

  /**
   * Points the camera at the loaded terrain.
   *
   * Captured builds and the terrain around them are often hundreds of blocks
   * apart vertically, so framing one leaves the other off screen entirely.
   */
  focusTerrain() {
    if (!this.terrainTiles?.length) return false;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const tile of this.terrainTiles) {
      const b = tile.userData.bounds;
      minX = Math.min(minX, b.center.x - b.radius);
      minY = Math.min(minY, b.center.y - b.radius);
      minZ = Math.min(minZ, b.center.z - b.radius);
      maxX = Math.max(maxX, b.center.x + b.radius);
      maxY = Math.max(maxY, b.center.y + b.radius);
      maxZ = Math.max(maxZ, b.center.z + b.radius);
    }

    this.centre = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    this.frame([maxX - minX, maxY - minY, maxZ - minZ]);
    return true;
  }

  clearTerrain() {
    if (!this.terrainGroup) return;
    for (const child of this.terrainGroup.children) child.material.dispose();
    this.terrainGroup.children[0]?.geometry.dispose();
    this.scene.remove(this.terrainGroup);
    this.terrainGroup = null;
    this.terrainTiles = [];
    this.needsRender = true;
  }

  /**
   * Hides tiles whose bounds are outside the camera frustum. Done by hand
   * because three cannot cull an InstancedMesh correctly on its own.
   */
  cullTerrain() {
    if (!this.terrainTiles?.length) return;
    this.camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(m);
    for (const tile of this.terrainTiles) {
      tile.visible = frustum.intersectsSphere(tile.userData.bounds);
    }
  }

  /** Additive glow over whatever the levers are currently powering. */
  setPowered(poweredKeys) {
    if (this.power) {
      this.group.remove(this.power);
      this.power.geometry.dispose();
      this.power.material.dispose();
      this.power = null;
    }

    const lit = this.allCells.filter(
      (c) => c.kept && poweredKeys.has(`${c.lx},${c.ly},${c.lz}`)
    );
    if (!lit.length) {
      this.needsRender = true;
      return 0;
    }

    const geometry = new THREE.BoxGeometry(1.06, 1.06, 1.06);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff4d3a,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const mesh = new THREE.InstancedMesh(geometry, material, lit.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const quat = new THREE.Quaternion();

    for (let i = 0; i < lit.length; i++) {
      position.set(lit[i].x + 0.5, lit[i].y + 0.5, lit[i].z + 0.5);
      matrix.compose(position, quat, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;

    this.power = mesh;
    this.group.add(mesh);
    this.needsRender = true;
    return lit.length;
  }

  clear() {
    for (const mesh of [this.solid, this.ghost, this.power]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.solid = this.ghost = this.power = null;
    this.solidCells = [];

    if (this.entityGroup) {
      for (const child of this.entityGroup.children) {
        child.geometry.dispose();
        child.material.dispose();
      }
      this.group.remove(this.entityGroup);
      this.entityGroup = null;
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
      this.grid = null;
    }
    this.clearSelection();
  }

  /* ---------------------------------------------------------------- *
   * Selection
   * ---------------------------------------------------------------- */

  /** @returns {object|null} the cell under the given screen point */
  pick(clientX, clientY) {
    if (!this.solid) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObject(this.solid, false);
    if (!hits.length) return null;
    const id = hits[0].instanceId;
    return id === undefined ? null : this.solidCells[id] ?? null;
  }

  setSelection(min, max) {
    this.selection = { min, max };
    this.drawSelection();
    this.handlers.onSelection?.(this.selection);
  }

  clearSelection() {
    this.selection = null;
    if (this.selectionMesh) {
      this.scene.remove(this.selectionMesh);
      this.selectionMesh.geometry.dispose();
      this.selectionMesh.material.dispose();
      this.selectionMesh = null;
    }
    this.needsRender = true;
  }

  drawSelection() {
    if (this.selectionMesh) {
      this.scene.remove(this.selectionMesh);
      this.selectionMesh.geometry.dispose();
      this.selectionMesh.material.dispose();
      this.selectionMesh = null;
    }
    if (!this.selection) return;

    const { min, max } = this.selection;
    const sx = max.x - min.x + 1;
    const sy = max.y - min.y + 1;
    const sz = max.z - min.z + 1;

    const box = new THREE.BoxGeometry(sx, sy, sz);
    const edges = new THREE.EdgesGeometry(box);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x6ce0ec, depthTest: false })
    );
    line.position.set(min.x + sx / 2, min.y + sy / 2, min.z + sz / 2);
    line.renderOrder = 10;
    box.dispose();

    this.selectionMesh = line;
    this.scene.add(line);
    this.needsRender = true;
  }

  /* ---------------------------------------------------------------- *
   * Controls
   * ---------------------------------------------------------------- */

  bindControls() {
    const el = this.canvas;

    let gesture = null;      // "orbit" | "pan" | "pinch" | "region"
    let start = null;
    let last = null;
    let lastPinch = 0;
    let downAt = 0;
    let holdTimer = null;
    let anchorCell = null;
    let moved = 0;

    const point = (e) => ({ x: e.clientX, y: e.clientY });
    const mid = (t) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2
    });
    const gap = (t) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const beginHold = (p) => {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        // Long press: anchor a region at whatever is under the finger and let
        // the drag that follows stretch it, rather than orbiting.
        const cell = this.pick(p.x, p.y);
        if (!cell) return;
        anchorCell = cell;
        gesture = "region";
        this.setSelection(
          { x: cell.x, y: cell.y, z: cell.z },
          { x: cell.x, y: cell.y, z: cell.z }
        );
        this.handlers.onRegionStart?.(cell);
      }, HOLD_MS);
    };

    const extendRegion = (p) => {
      const cell = this.pick(p.x, p.y);
      if (!cell || !anchorCell) return;
      this.setSelection(
        {
          x: Math.min(anchorCell.x, cell.x),
          y: Math.min(anchorCell.y, cell.y),
          z: Math.min(anchorCell.z, cell.z)
        },
        {
          x: Math.max(anchorCell.x, cell.x),
          y: Math.max(anchorCell.y, cell.y),
          z: Math.max(anchorCell.z, cell.z)
        }
      );
    };

    const finish = (p) => {
      clearTimeout(holdTimer);
      const heldFor = performance.now() - downAt;

      if (gesture === "region") {
        this.handlers.onRegionEnd?.(this.selection);
      } else if (heldFor < TAP_MS && moved < TAP_SLOP && p) {
        const cell = this.pick(p.x, p.y);
        if (cell) {
          this.setSelection(
            { x: cell.x, y: cell.y, z: cell.z },
            { x: cell.x, y: cell.y, z: cell.z }
          );
          this.handlers.onTap?.(cell);
        } else {
          this.clearSelection();
          this.handlers.onTap?.(null);
        }
      }

      gesture = null;
      start = last = null;
      anchorCell = null;
      lastPinch = 0;
      moved = 0;
    };

    /* ---- mouse / stylus ---- */

    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      el.setPointerCapture(e.pointerId);
      start = last = point(e);
      downAt = performance.now();
      moved = 0;
      gesture = e.button === 2 || e.shiftKey ? "pan" : "orbit";
      if (gesture === "orbit") beginHold(start);
    });

    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" || !last) return;
      const now = point(e);
      moved += Math.abs(now.x - last.x) + Math.abs(now.y - last.y);
      if (moved > TAP_SLOP) clearTimeout(holdTimer);

      if (gesture === "region") extendRegion(now);
      else this.drag(gesture, now.x - last.x, now.y - last.y);
      last = now;
    });

    const endPointer = (e) => {
      if (e.pointerType === "touch") return;
      finish(last ?? start);
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

    /* ---- touch ---- */

    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (e.touches.length === 1) {
          start = last = point(e.touches[0]);
          downAt = performance.now();
          moved = 0;
          gesture = "orbit";
          beginHold(start);
        } else if (e.touches.length === 2) {
          clearTimeout(holdTimer);
          gesture = "pinch";
          last = mid(e.touches);
          lastPinch = gap(e.touches);
        }
      },
      { passive: false }
    );

    el.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        if (!last) return;

        if (gesture === "region" && e.touches.length === 1) {
          extendRegion(point(e.touches[0]));
          return;
        }

        if (e.touches.length === 1 && gesture === "orbit") {
          const now = point(e.touches[0]);
          moved += Math.abs(now.x - last.x) + Math.abs(now.y - last.y);
          if (moved > TAP_SLOP) clearTimeout(holdTimer);
          this.drag("orbit", now.x - last.x, now.y - last.y);
          last = now;
        } else if (e.touches.length === 2 && gesture === "pinch") {
          const g = gap(e.touches);
          if (lastPinch > 0) this.zoom(lastPinch / g);
          lastPinch = g;
          const m = mid(e.touches);
          this.drag("pan", m.x - last.x, m.y - last.y);
          last = m;
        }
      },
      { passive: false }
    );

    const endTouch = (e) => {
      e.preventDefault();
      finish(last);
    };
    el.addEventListener("touchend", endTouch, { passive: false });
    el.addEventListener("touchcancel", endTouch, { passive: false });
  }

  drag(mode, dx, dy) {
    this.userAdjusted = true;
    if (mode === "pan") {
      const scale = this.spherical.radius * 0.0016;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      this.target.addScaledVector(right, -dx * scale);
      this.target.addScaledVector(up, dy * scale);
    } else {
      this.spherical.theta -= dx * 0.006;
      this.spherical.phi = clamp(this.spherical.phi - dy * 0.006, 0.02, Math.PI - 0.02);
    }
    this.applyCamera();
  }

  zoom(factor) {
    this.userAdjusted = true;
    this.spherical.radius = clamp(this.spherical.radius * factor, 2, 12000);
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
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.needsRender = true;
  }

  /**
   * Fits the bounding sphere against BOTH axes: on a phone held upright the
   * horizontal field of view is much narrower than the vertical one, so
   * fitting only vertically puts the camera inside a wide build.
   */
  frame(span) {
    this.fitSize = span;
    this.userAdjusted = false;

    const radius = 0.5 * Math.hypot(span[0], span[1], span[2]);
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;

    const distV = radius / Math.sin(fov / 2);
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const distH = radius / Math.sin(hFov / 2);

    if (this.centre) this.target.copy(this.centre);
    this.spherical.radius = Math.max(distV, distH) * 1.2;
    this.spherical.theta = Math.PI * 0.25;
    this.spherical.phi = Math.PI * 0.32;
    this.applyCamera();
  }

  recentre() {
    if (this.fitSize) this.frame(this.fitSize);
  }

  /* ---------------------------------------------------------------- *
   * Frame loop
   * ---------------------------------------------------------------- */

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (this.fitSize && !this.userAdjusted) this.frame(this.fitSize);
    this.needsRender = true;
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());
    if (!this.needsRender) return;
    this.needsRender = false;
    this.cullTerrain();
    this.renderer.render(this.scene, this.camera);
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
