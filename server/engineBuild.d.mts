// Types of engineBuild.mjs, for vite.config.ts (the server itself is plain JavaScript).
export const ENGINE_ENTRY: string;
export const BUILT_ENGINE: string;
export function buildEngine(outfile: string): Promise<string>;
