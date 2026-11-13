// A few real-format cash hands from the engine's parser tests, for a first visit with no hands of your own: imported like
// any others (one import named "Sample hands", deleted from Imports like any other), so nothing about them is special.
// Eight different hands: the tests also write some hands out again in other rooms' formats (the 6-max single-raised pot in
// Ignition's and 888's, the 3bet pot in Winamax's, the all-in in Party's), which as samples were the same hand twice or
// three times.
const RAW = import.meta.glob(
  "../../../../solver/tests/data/hh/{stars_6max_srp,stars_3bet_pot,stars_heads_up,gg_limped_multiway,gg_allin_preflop,gg_straddle,stars_zoom_names,stars_run_twice}.txt",
  { query: "?raw", import: "default" },
);

export const SAMPLE_NAME = "Sample hands";

export async function sampleFiles(): Promise<{ name: string; text: string }[]> {
  return Promise.all(Object.entries(RAW).map(async ([path, load]) => ({ name: path.split("/").pop()!, text: String(await load()) })));
}
