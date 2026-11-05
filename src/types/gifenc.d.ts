declare module "gifenc/dist/gifenc.esm.js" {
  export interface GifFrameOptions {
    palette?: number[][];
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
    colorDepth?: number;
  }
  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void;
    writeHeader(): void;
    finish(): void;
    reset(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBuffer;
  }
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
  const defaultExport: typeof GIFEncoder;
  export default defaultExport;
  export function quantize(rgba: Uint8Array, maxColors: number, options?: Record<string, unknown>): number[][];
  export function applyPalette(rgba: Uint8Array, palette: number[][], format?: string): Uint8Array;
  export function nearestColorIndex(palette: number[][], pixel: number[]): number;
}
