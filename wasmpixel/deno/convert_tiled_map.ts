import { readAll } from "https://deno.land/std@0.196.0/streams/read_all.ts";
import { z } from "https://deno.land/x/zod@v3.16.1/mod.ts";

const filearray = await readAll(Deno.stdin);
const filedata = new TextDecoder().decode(filearray);

console.error(`parsing stdin input (${filedata.length} chars)`);

const mapJson = JSON.parse(filedata);

const zTileLayerChunk = z.object({
  data: z.array(z.number()),
  height: z.number(),
  width: z.number(),
  x: z.number(),
  y: z.number(),
});

const zPropertyLayerFlag = z.object({
  name: z.string(),
  type: z.literal("bool"),
  value: z.boolean(),
});

const zPropertyObjectInstanceName = z.object({
  name: z.literal("instance_name"),
  type: z.literal("string"),
  value: z.string(),
});

const zTileLayer = z.object({
  type: z.literal("tilelayer"),
  name: z.string(),
  chunks: z.array(zTileLayerChunk),
  properties: z.array(zPropertyLayerFlag).optional(),
});

const zObject = z.object({
  gid: z.number(),
  x: z.number(),
  y: z.number(),
  properties: z.array(zPropertyObjectInstanceName).optional(),
});

const zObjectLayer = z.object({
  type: z.literal("objectgroup"),
  name: z.string(),
  objects: z.array(zObject),
  properties: z.array(zPropertyLayerFlag).optional(),
});

const zLayer = z.discriminatedUnion("type", [zTileLayer, zObjectLayer]);

const zMap = z.object({
  type: z.literal("map"),
  infinite: z.literal(true),
  tilewidth: z.number(),
  tileheight: z.number(),
  layers: z.array(zLayer),
});

const tiledMap = zMap.parse(mapJson);

console.error(`parsed map input: ${JSON.stringify(tiledMap)}`);

type Tile = {
  tileId: number;
  x: number;
  y: number;
  walkable: boolean;
  instance_name: string | undefined;
};

type Flags = {
  walkable: boolean;
};

function parseTileLayer(layer: z.infer<typeof zTileLayer>, input: z.infer<typeof zMap>, remapGid: (gid: number) => number, flags: Flags) {
  const tiles: Tile[] = [];
  for (const chunk of layer.chunks) {
    for (let dy = 0; dy < chunk.height; dy += 1) {
      for (let dx = 0; dx < chunk.width; dx += 1) {
        const gid = chunk.data[dy * chunk.height + dx];
        if (gid === 0) continue;
        tiles.push({
          tileId: remapGid(gid),
          x: (chunk.x + dx) * input.tilewidth,
          y: (chunk.y + dy) * input.tileheight,
          walkable: flags.walkable,
          instance_name: undefined,
        });
      }
    }
  }
  return { name: layer.name, tiles };
}

function parseObjectLayer(layer: z.infer<typeof zObjectLayer>, input: z.infer<typeof zMap>, remapGid: (gid: number) => number, flags: Flags) {
  const tiles: Tile[] = layer.objects.flatMap((o) => {
    let instance_name = undefined;
    for (const p of o.properties ?? []) {
      switch (p.name) {
        case "instance_name":
          instance_name = p.value;
          break;
        default:
          throw new Error(`unexpected object property: ${JSON.stringify(p)}`);
      }
    }
    return [
      {
        tileId: remapGid(o.gid),
        x: o.x,
        y: o.y - input.tileheight,
        walkable: flags.walkable,
        instance_name,
      },
    ];
  });
  return { name: layer.name, tiles };
}

function checkUnreachable(input: never) {
  console.error(`checkUnreachable() reached with input: ${input}`);
  throw new Error(`checkUnreachable() reached with input: ${input}`);
}

function parseLayer(layer: z.infer<typeof zLayer>, input: z.infer<typeof zMap>, remapGid: (gid: number) => number) {
  const flags = {
    walkable: false,
  };
  for (const p of layer.properties ?? []) {
    if (p.value !== true) continue;
    switch (p.name) {
      case "skip_when_exporting":
        return [];
      case "walkable":
        flags.walkable = true;
        break;
      default:
        throw new Error(`unexpected layer property: ${JSON.stringify(p)}`);
    }
  }
  switch (layer.type) {
    case "tilelayer":
      return [parseTileLayer(layer, input, remapGid, flags)];
    case "objectgroup":
      return [parseObjectLayer(layer, input, remapGid, flags)];
    default:
      checkUnreachable(layer);
  }
}

function collectUsedGids(input: z.infer<typeof zMap>) {
  const gids = new Set<number>();
  for (const layer of input.layers) {
    switch (layer.type) {
      case "tilelayer":
        for (const chunk of layer.chunks) {
          for (const gid of chunk.data) {
            if (gid !== 0) {
              gids.add(gid);
            }
          }
        }
        break;
      case "objectgroup":
        for (const o of layer.objects) {
          gids.add(o.gid);
        }
        break;
      default:
        checkUnreachable(layer);
    }
  }
  return gids;
}

function parseMap(input: z.infer<typeof zMap>) {
  const usedGids = collectUsedGids(input);
  const gidLookup = new Map<number, number>();
  const gidMap: number[] = [];
  for (const gid of usedGids) {
    gidLookup.set(gid, gidLookup.size);
    gidMap.push(gid);
  }
  function remapGid(gid: number) {
    const mapped = gidLookup.get(gid);
    if (mapped === undefined) {
      throw new Error(`internal error: couldn't resolve gid=${gid}`);
    }
    return mapped;
  }
  return {
    layers: input.layers.flatMap((l) => parseLayer(l, input, remapGid)),
    gidMap,
  };
}

const parsedMap = parseMap(tiledMap);
console.log(JSON.stringify(parsedMap));

await Deno.writeTextFile("converted-map-layers.json", JSON.stringify(parsedMap.layers));

const tiledTilesetMap = exportTiledTilesetMap(parsedMap.gidMap);
await Deno.writeTextFile("tiled-tileset-map.json", JSON.stringify(tiledTilesetMap));

function exportTiledTilesetMap(gidMap: number[]) {
  return {
    compressionlevel: -1,
    height: 1,
    infinite: false,
    layers: [
      {
        data: gidMap,
        height: 1,
        id: 1,
        name: "Gid map for export",
        opacity: 1,
        type: "tilelayer",
        visible: true,
        width: gidMap.length,
        x: 0,
        y: 0,
      },
    ],
    nextlayerid: 2,
    nextobjectid: 1,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: "1.10.1",
    tileheight: 50,
    tilesets: [
      {
        firstgid: 1,
        source: "cycle_tileset.tsx",
      },
    ],
    tilewidth: 50,
    type: "map",
    version: "1.10",
    width: gidMap.length,
  };
}
