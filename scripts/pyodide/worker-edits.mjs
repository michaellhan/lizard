// What Lizard changes in solver/gto/static/worker.js as it publishes it. The file in solver/ stays as upstream has it;
// each edit is declared in solver/UPSTREAM.json. Every "from" must appear exactly once, so an upstream change that
// moves one fails the build here rather than publishing a worker with the edit silently missing.
const EDITS = [
  {
    // The classic app on the same origin uses "gto-solver", and the worker evicts any other cached solver.zip when it
    // stores its own, so the two apps would keep evicting each other.
    from: 'caches.open("gto-solver")',
    to: 'caches.open("lizard:solver")',
  },
  {
    // Pyodide from Lizard's own origin (scripts/pyodide/stage.mjs): relative, like the worker's solver.zip, so it
    // follows the worker's URL under any base. importScripts takes no integrity, so a CDN could run anything here,
    // in the origin that holds the user's hand histories.
    from: 'const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";',
    to: 'const PYODIDE = "pyodide/";',
  },
  {
    // (the comment on the numpy prefetch, which said where the files came from)
    from: "the HTTP cache (jsdelivr caches versioned files for a year) rather than",
    to: "the HTTP cache rather than",
  },
  {
    // A node lock's progress (engine/study_lock.py, in solver.zip beside gto/): it blocks this thread like any solve, so
    // the request's {partial} messages go out from inside it. The request running is CUR.
    from: 'py.globals.set("stop_now", stopNow);',
    to: 'py.globals.set("stop_now", stopNow);\n  py.globals.set("post_partial", (s) => postMessage({ id: CUR, partial: JSON.parse(s) }));',
  },
  {
    // A Study request with state.nodelock (web/src/solver/client.ts nodeLock) goes to the node lock, not the advice; an
    // opponent's move with a read in its state (Exploit practice, web/src/features/practice/flow.ts) goes to
    // engine/exploit_play.py, which draws it from the read the player's answer best-responds to.
    // Imported on first use: nothing else in the worker loads engine/. A cancel stays the handler's below it.
    from: `+ "        return json.dumps(adv.play(st, pl['seat'], pl['hole'], pl.get('seed')) if pl else adv.advise(st))\\n"`,
    to:
      `+ "        if st.get('nodelock') and not pl:\\n"\n` +
      `             + "            from engine.study_lock import answer as locked\\n"\n` +
      `             + "            return json.dumps(locked(adv, st, lambda p: post_partial(json.dumps(p))))\\n"\n` +
      `             + "        if pl and st.get('locks'):\\n"\n` +
      `             + "            from engine.exploit_play import play as read_play\\n"\n` +
      `             + "            return json.dumps(read_play(adv, st, pl['seat'], pl['hole'], pl.get('seed')))\\n"\n` +
      `             + "        return json.dumps(adv.play(st, pl['seat'], pl['hole'], pl.get('seed')) if pl else adv.advise(st))\\n"`,
  },
  {
    // Lizard's stored preflop games (engine/pf_stored.py, in solver.zip beside gto/): importing it adds them to
    // pf_study.STORED, so the worker answers them from the site's pf/<key>.bin as it does upstream's two. Once, at start,
    // before any request is answered.
    from: "sys.path.insert(0, '/app'); from gto.advisor import Advisor;",
    to: "sys.path.insert(0, '/app'); import engine.pf_stored; from gto.advisor import Advisor;",
  },
  {
    // The preflop solve (Study's Solver source, Practice's and Analyze's "grade by the preflop solve": a request with
    // state.study and state.preflop_solve and no board) goes to Lizard's preflop solver (engine/pf_solve.py: each seat's
    // own stack, 2 to 9 players, the calibrated flop model), which keeps Advisor._study_pf's protocol. A tournament's
    // (payouts or bounties) stays Advisor's. After the nodelock edit above, whose branch it goes before.
    from: `+ "        if st.get('nodelock') and not pl:\\n"`,
    to:
      `+ "        if st.get('study') and st.get('preflop_solve') and not pl and not str(st.get('board') or '') and not st.get('payouts') and not st.get('bounties'):\\n"\n` +
      `             + "            from engine.pf_solve import answer as pf_answer\\n"\n` +
      `             + "            return json.dumps(pf_answer(adv, st))\\n"\n` +
      `             + "        if st.get('nodelock') and not pl:\\n"`,
  },
  {
    // A tournament's preflop solved in prize equity (engine/pf_icm_study.py, on engine/pf_icm.py): importing it wraps
    // Advisor._study_pf so a Study preflop-solve request with payouts or bounties is answered there (upstream answers
    // those "pf_none"), everything else as before. Once, at start, after the stored games (this edit runs on the one
    // above's output).
    from: "import engine.pf_stored; from gto.advisor import Advisor;",
    to: "import engine.pf_stored; import engine.pf_icm_study; from gto.advisor import Advisor;",
  },
  {
    // engine/tree_depth.py: a request's `raises` (1-4 a street) and `max_cells` (this device's tree cap, at most
    // tree_depth.BROWSER_MAX here) for its heads-up solves; a request without them is upstream's. Last, and anchored on
    // the Advisor's import alone, so other imports chained on the pf_stored line above stay in front of it.
    from: "from gto.advisor import Advisor;",
    to: "import engine.tree_depth; from gto.advisor import Advisor;",
  },
  {
    // engine/bunching.py: a request's `bunching` ("charts" or "solve": whose preflop fold ranges) weighs the ranges
    // entering the flop by the folded seats' hands and solves every street live on them; a request without it is
    // upstream's. After tree_depth, so it wraps tree_depth's wrap of Advisor._advise_at (this edit runs on that one's
    // output).
    from: "import engine.tree_depth; from gto.advisor import Advisor;",
    to: "import engine.tree_depth; import engine.bunching; from gto.advisor import Advisor;",
  },
];

export function editWorker(source) {
  let out = source;
  for (const { from, to } of EDITS) {
    if (out.split(from).length !== 2) {
      throw new Error(`worker.js: expected exactly one ${from}; the upstream worker changed, update scripts/pyodide/worker-edits.mjs`);
    }
    out = out.replace(from, () => to);
  }
  return out;
}

/** Every third-party host a published worker names, in code or comments: any absolute URL, and the CDN by name. */
export function hostsNamed(worker) {
  const urls = [...worker.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`)]*|(?<![:/\w])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\//gi)].map((m) => m[0]);
  const cdn = [...worker.matchAll(/jsdelivr|unpkg|cdnjs/gi)].map((m) => m[0]);
  return [...urls, ...cdn];
}
