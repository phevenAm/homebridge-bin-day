import type { CouncilResult } from './types';
import { fetchWokingham } from './wokingham';

export type CouncilFetcher = (postcode: string, houseNumber: string) => Promise<CouncilResult>;

/** Add more councils here later. */
export const COUNCILS: Record<string, CouncilFetcher> = {
  wokingham: fetchWokingham,
};

export type { BinCollection, CouncilResult } from './types';
