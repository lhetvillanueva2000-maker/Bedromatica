/**
 * Block surface texture, generated at runtime.
 *
 * Minecraft's own textures are Mojang's assets and are not shipped here. What
 * this does instead is generate one shared greyscale detail map - grain plus a
 * bevelled edge - which the shader multiplies by each block's own colour. One
 * texture and one material means the whole scene still draws as two instanced
 * meshes, and every block still reads as a distinct material rather than a
 * flat-shaded cube.
 */

/**
 * @param {number} size pixels per side; 16 matches Minecraft's own grid
 * @returns {THREE.CanvasTexture}
 */
export function blockDetailTexture(size = 16) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const data = image.data;

  // A fixed seed: the grain should be identical every run, so a screenshot of
  // the same build looks the same twice.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Grain: small per-pixel variation so faces are not dead flat.
      let v = 0.86 + rand() * 0.14;

      // Bevel: lift the top-left edge and drop the bottom-right, which reads
      // as a raised block face under any light direction.
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (edge === 0) v *= x < 2 || y < 2 ? 1.1 : 0.78;
      else if (edge === 1) v *= 0.96;

      // A few darker speckles break up large same-colour surfaces.
      if (rand() > 0.94) v *= 0.82;

      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * size + x) * 4;
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  // Nearest filtering keeps the pixel grid crisp instead of smearing it, which
  // is what makes it read as Minecraft rather than as noise.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  return texture;
}

/**
 * Flat, slightly translucent map for the ghosted blocks. Separate from the
 * solid one so ghosts stay readable as "not really there".
 */
export function ghostTexture(size = 16) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}
