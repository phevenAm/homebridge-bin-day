export interface BinCollection {
  /** Bin name as the council writes it, e.g. "Recycling". */
  type: string;
  /** Next collection date, as YYYY-MM-DD. */
  date: string;
}

export interface CouncilResult {
  address: string;
  bins: BinCollection[];
}
