let screenWidth = 320;
let screenHeight = 200;
export let screenOffset: usize = 0;

let tilemapWidth = 0;
let tilemapHeight = 0;
export let tilemapOffset: usize = 0;

let mapNumTiles = 0;
export let mapOffsetX: usize = 0;
export let mapOffsetY: usize = 0;
export let mapOffsetTileId: usize = 0;
export let mapOffsetFlags: usize = 0;

const FLAG_WALL_BLOCKS_WALKING = 1;
const FLAG_INTERACTABLE = 2;
const FLAG_ITEM_COLLECTED = 4;

function store32(ptr: usize, offset: usize, value: u32): void {
  store<u32>(ptr + offset * sizeof<u32>(), value);
}

function load32(ptr: usize, offset: usize): u32 {
  return load<u32>(ptr + offset * sizeof<u32>());
}

function getPixel(x: i32, y: i32): u32 {
  if (x < 0 || x >= screenWidth || y < 0 || y >= screenHeight) {
    return 0;
  }
  return load32(screenOffset, x + y * screenWidth);
}

function setPixel(x: i32, y: i32, v: u32): void {
  if (x < 0 || x >= screenWidth || y < 0 || y >= screenHeight) {
    return;
  }
  store32(screenOffset, x + y * screenWidth, v);
}

function loadTilemapPixel(x: i32, y: i32): u32 {
  if (x < 0 || x >= tilemapWidth || y < 0 || y >= tilemapHeight) {
    return 0;
  }
  return load32(tilemapOffset, x + y * tilemapWidth);
}

function traceall(msg: string): void {
  trace(msg, 1, 12345);
  trace("screen", 1, screenOffset);
  trace("tilemap", 1, tilemapOffset);
  trace("mapX", 1, mapOffsetX);
  trace("mapY", 1, mapOffsetY);
  trace("mapTileId", 1, mapOffsetTileId);
  trace("memory size", 1, memory.size() << 16);
  trace(msg, 1, 54321);
}

function blend(previous: u32, target: u32, alphaBlend: f32): u32 {
  const newValue = (previous as f32) * (1.0 - alphaBlend) + (target as f32) * alphaBlend;
  // trace("blend", 4, previous, target, (alphaBlend * 1000000) as u32, (newValue * 1000000) as u32);
  if (newValue < 0) return 0;
  if (newValue > 255) return 255;
  return newValue as u32;
}

function rgbToI32(r: u32, g: u32, b: u32): u32 {
  return r + (g << 8) + (b << 16) + (255 << 24);
}

function place_tile(idx: i32, x: i32, y: i32, alphaBlend: f32): void {
  for (let dy = 0; dy < 50; dy += 1) {
    for (let dx = 0; dx < 50; dx += 1) {
      const value = loadTilemapPixel(idx * 50 + dx, dy);
      const r = value % 256;
      const g = (value >> 8) % 256;
      const b = (value >> 16) % 256;
      const a = (value >> 24) % 256;
      if (alphaBlend === 1.0) {
        if (a !== 0) {
          setPixel(x + dx, y + dy, value);
        }
      } else {
        if (a !== 0) {
          const oldValue = getPixel(x + dx, y + dy);
          const oldR = oldValue % 256;
          const oldG = (oldValue >> 8) % 256;
          const oldB = (oldValue >> 16) % 256;
          const newR = blend(oldR, r, alphaBlend);
          const newG = blend(oldG, g, alphaBlend);
          const newB = blend(oldB, b, alphaBlend);
          setPixel(x + dx, y + dy, rgbToI32(newR, newG, newB));
        }
      }
      // setPixel(x + dx, y + dy, rgbToI32(a, a, a));
    }
  }
}

/** Performs one tick. */
export function update(tick: f32, playerx: i32, playery: i32, player_image: i32): void {
  for (let y = 0; y < screenHeight; y += 1) {
    for (let x = 0; x < screenWidth; x += 1) {
      setPixel(x, y, 0);
      setPixel(x, y, rgbToI32(200, 20, 180));
    }
  }
  if (tilemapWidth === 0 || mapNumTiles === 0) {
    return;
  }

  for (let tileIdx = 0; tileIdx < mapNumTiles; tileIdx += 1) {
    const x = load32(mapOffsetX, tileIdx);
    const y = load32(mapOffsetY, tileIdx);
    const tileId = load32(mapOffsetTileId, tileIdx);
    const flags = load32(mapOffsetFlags, tileIdx);
    if (flags & FLAG_ITEM_COLLECTED) {
      place_tile(tileId, screenWidth / 2 - playerx + x - 25, screenHeight / 2 - playery + y - 25, 1.0 / 3.0);
    } else {
      place_tile(tileId, screenWidth / 2 - playerx + x - 25, screenHeight / 2 - playery + y - 25, 1.0);
    }
  }
  place_tile(player_image, screenWidth / 2 - 25, screenHeight / 2 - 25, 1.0);
}

/** Recomputes and potentially grows memory on resize of the viewport. */
export function resizeMemory(w: i32, h: i32): void {
  screenWidth = w;
  screenHeight = h;
  // WASM memory pages are 64kb = 2**16 each.
  const needed = ((<i32>(screenOffset + w * h * sizeof<i32>())) >>> 16) + 1;
  const actual = memory.size();
  if (needed > actual) memory.grow(needed - actual);
}

export function setScreenSize(ptr: usize, w: i32, h: i32): void {
  traceall("set screen - before");
  screenWidth = w;
  screenHeight = h;
  screenOffset = ptr;
  traceall("set screen - after");
}

export function setTilemapSize(ptr: usize, w: i32, h: i32): void {
  traceall("set tilemap - before");
  tilemapWidth = w;
  tilemapHeight = h;
  tilemapOffset = ptr;
  traceall("set tilemap - after");
}

export function setMapSize(numTiles: i32, ptrX: usize, ptrY: usize, ptrTileId: usize, ptrFlags: usize): void {
  traceall("set map - before");
  mapNumTiles = numTiles;
  mapOffsetX = ptrX;
  mapOffsetY = ptrY;
  mapOffsetTileId = ptrTileId;
  mapOffsetFlags = ptrFlags;
  traceall("set map - after");
}

export function moveResult(x: i32, y: i32): i32 {
  for (let tileIdx = 0; tileIdx < mapNumTiles; tileIdx += 1) {
    const flags = load32(mapOffsetFlags, tileIdx);
    if (flags & FLAG_WALL_BLOCKS_WALKING) {
      const tileX: i32 = load32(mapOffsetX, tileIdx);
      const tileY: i32 = load32(mapOffsetY, tileIdx);
      // trace("walkable-check tile", 2, tileIdx, flags);
      // trace("walkable-check x-y", 4, x, y, tileX, tileY);
      if (x + 25 >= tileX && x + 25 <= tileX + 50) {
        if (y + 25 >= tileY && y + 25 <= tileY + 50) {
          return -2;
        }
      }
    }
  }
  for (let tileIdx = 0; tileIdx < mapNumTiles; tileIdx += 1) {
    const flags = load32(mapOffsetFlags, tileIdx);
    if (flags & FLAG_INTERACTABLE) {
      const tileX = load32(mapOffsetX, tileIdx);
      const tileY = load32(mapOffsetY, tileIdx);
      const dx = x - tileX;
      const dy = y - tileY;
      // trace("interactable-check tile", 2, tileIdx, flags);
      // trace("interactable-check x-y", 4, x, y, tileX, tileY);
      // trace("interactable-check dx-dy", 4, dx, dy, dx * dx + dy * dy, 50 * 50);
      if (dx * dx + dy * dy < 50 * 50) {
        // trace("interactable-check MATCH!!!!", 1, tileIdx);
        return tileIdx;
      }
    }
  }
  return -1;
}

export const Int32Array_ID = idof<Int32Array>();
