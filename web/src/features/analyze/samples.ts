// A few real-format cash hands from the engine's parser tests, for a first visit with no hands of your own: imported like
// any others (one import named "Sample hands", deleted from Imports like any other), so nothing about them is special.
const RAW = import.meta.glob(
  "../../../../solver/tests/data/hh/{stars_6max_srp,stars_3bet_pot,stars_heads_up,ignition_6max_srp,888_6max_srp,gg_limped_multiway,gg_allin_preflop,winamax_3bet_pot,party_6max_allin}.txt",
  { query: "?raw", import: "default" },
);

export const SAMPLE_NAME = "Sample hands";

export async function sampleFiles(): Promise<{ name: string; text: string }[]> {
  return Promise.all(Object.entries(RAW).map(async ([path, load]) => ({ name: path.split("/").pop()!, text: String(await load()) })));
}
