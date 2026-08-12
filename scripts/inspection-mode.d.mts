export type InspectionMode = 'strict' | 'paused';

export const INSPECTION_STRICT: 'strict';
export const INSPECTION_PAUSED: 'paused';
export const INSPECTION_MODE_ERROR: string;

export function readInspectionMode(env?: NodeJS.ProcessEnv): InspectionMode | null;
export function isInspectionPaused(env?: NodeJS.ProcessEnv): boolean;
export function expectedInspectionFlag(mode: InspectionMode | null): 'true' | 'false';
export function inspectionPauseBanner(target: string): string;
