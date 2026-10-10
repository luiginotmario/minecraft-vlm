export const CS = 16; // chunk size along x and z
export const CH = 128; // chunk height
export const SEA = 32;

/** Numeric chunk key; cx/cz must stay within ±32767. */
export const chunkKey = (cx: number, cz: number) => ((cx + 32768) << 16) | (cz + 32768);
export const voxelIndex = (x: number, y: number, z: number) => (y * CS + z) * CS + x;

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const COBBLE = 4;
export const PLANKS = 5;
export const LOG = 6;
export const LEAVES = 7;
export const GLASS = 8;
export const BRICK = 9;
export const SAND = 10;
export const WATER = 11;
export const COAL = 12;
export const IRON = 13;
export const BEDROCK = 14;
export const SNOW = 15;

// Texture layers in the array texture.
export const T = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  PLANKS: 5,
  LOG_SIDE: 6,
  LOG_TOP: 7,
  LEAVES: 8,
  GLASS: 9,
  BRICK: 10,
  SAND: 11,
  WATER: 12,
  COAL: 13,
  IRON: 14,
  BEDROCK: 15,
  SNOW: 16,
  SNOW_SIDE: 17,
} as const;
export const TILE_COUNT = 18;

export interface BlockDef {
  name: string;
  /** Has collision. */
  solid: boolean;
  /** Hides neighbouring faces and casts ambient occlusion. */
  opaque: boolean;
  /** Rendered with alpha cutout. */
  cutout: boolean;
  liquid: boolean;
  /** Swings needed to break; 0 = unbreakable. */
  hits: number;
  /** Texture layers: top, bottom, side. */
  tex: [number, number, number];
}

const def = (
  name: string,
  tex: [number, number, number],
  hits: number,
  opts: Partial<Pick<BlockDef, 'solid' | 'opaque' | 'cutout' | 'liquid'>> = {},
): BlockDef => ({ name, tex, hits, solid: true, opaque: true, cutout: false, liquid: false, ...opts });

export const BLOCKS: BlockDef[] = [];
BLOCKS[AIR] = def('Air', [0, 0, 0], 0, { solid: false, opaque: false });
BLOCKS[GRASS] = def('Grass', [T.GRASS_TOP, T.DIRT, T.GRASS_SIDE], 1);
BLOCKS[DIRT] = def('Dirt', [T.DIRT, T.DIRT, T.DIRT], 1);
BLOCKS[STONE] = def('Stone', [T.STONE, T.STONE, T.STONE], 3);
BLOCKS[COBBLE] = def('Cobblestone', [T.COBBLE, T.COBBLE, T.COBBLE], 3);
BLOCKS[PLANKS] = def('Planks', [T.PLANKS, T.PLANKS, T.PLANKS], 2);
BLOCKS[LOG] = def('Log', [T.LOG_TOP, T.LOG_TOP, T.LOG_SIDE], 2);
BLOCKS[LEAVES] = def('Leaves', [T.LEAVES, T.LEAVES, T.LEAVES], 1, { opaque: false, cutout: true });
BLOCKS[GLASS] = def('Glass', [T.GLASS, T.GLASS, T.GLASS], 1, { opaque: false, cutout: true });
BLOCKS[BRICK] = def('Brick', [T.BRICK, T.BRICK, T.BRICK], 3);
BLOCKS[SAND] = def('Sand', [T.SAND, T.SAND, T.SAND], 1);
BLOCKS[WATER] = def('Water', [T.WATER, T.WATER, T.WATER], 0, { solid: false, opaque: false, liquid: true });
BLOCKS[COAL] = def('Coal Ore', [T.COAL, T.COAL, T.COAL], 4);
BLOCKS[IRON] = def('Iron Ore', [T.IRON, T.IRON, T.IRON], 4);
BLOCKS[BEDROCK] = def('Bedrock', [T.BEDROCK, T.BEDROCK, T.BEDROCK], 0);
BLOCKS[SNOW] = def('Snowy Grass', [T.SNOW, T.DIRT, T.SNOW_SIDE], 1);

// Flat lookup tables for hot loops.
export const IS_SOLID = new Uint8Array(256);
export const IS_OPAQUE = new Uint8Array(256);
for (let i = 0; i < BLOCKS.length; i++) {
  IS_SOLID[i] = BLOCKS[i].solid ? 1 : 0;
  IS_OPAQUE[i] = BLOCKS[i].opaque ? 1 : 0;
}

export const HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, LEAVES, GLASS, BRICK];
