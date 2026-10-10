/** Face landmark indices we forward from the 478-point mesh, in this order. */
export const FACE_IDS = [1, 234, 454, 10, 152, 33, 263, 13] as const;
export const F = { NOSE: 0, LEFT: 1, RIGHT: 2, TOP: 3, CHIN: 4, EYE_L: 5, EYE_R: 6, MOUTH: 7 } as const;

export interface HandFrame {
  /** 21 landmarks × (x, y, z), normalized image coords of the unmirrored frame. */
  lm: Float32Array;
  handed: string;
}

export interface VisionFrame {
  /** Capture timestamp (performance.now ms). */
  ts: number;
  /** Frame size, used to correct the aspect ratio of normalized coords. */
  w: number;
  h: number;
  /** FACE_IDS.length × (x, y, z), or null when no face is found. */
  face: Float32Array | null;
  hands: HandFrame[];
  /** Inference time in ms. */
  ms: number;
}

export type ToVision =
  | { t: 'init'; wasmBase: string; handModel: string; faceModel: string; fallbackHand: string; fallbackFace: string }
  | { t: 'frame'; bitmap: ImageBitmap; ts: number };

export type FromVision =
  | { t: 'ready'; delegate: string }
  | { t: 'error'; message: string }
  | { t: 'result'; frame: VisionFrame };
