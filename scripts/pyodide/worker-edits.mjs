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
  {
    // engine/mw_near.py: a 3-way pot whose ranges are what a published 3-way spot's preflop line gives today, near the
    // ranges it was built on (the charts moved under all four on 2026-11-17), reads that spot's stored solve, labelled
    // approximate with the difference (precomputed.borrowed.built and .text); a later street narrowed through it is
    // marked approximate too (ranges_built), and a flop line the library stores only in part is solved from the street's
    // start rather than left to the rules. engine/mw_quick.py: a quick answer's 3-way street behind a bet is narrowed
    // through a short solve rather than the rules, its 3-way flop answer is marked approximate (the small game), and its
    // solves are kept apart from Fast's. After bunching, so mw_near wraps bunching's wrap of Advisor._advise_at and
    // mw_quick wraps mw_near's (this edit runs on that one's output). engine/hu_near.py: the same for a heads-up pot
    // whose ranges are what a published spot's preflop line gives today, near the ranges it was built on (the lz4 equity
    // table moved the four 200bb spots on 2026-11-22), read through upstream's own borrowing (flop_approx.near_exact);
    // it wraps flop_approx and flop_library, nothing the others hold.
    from: "import engine.bunching; from gto.advisor import Advisor;",
    to: "import engine.bunching; import engine.mw_near; import engine.hu_near; import engine.mw_quick; from gto.advisor import Advisor;",
  },
  {
    // engine/size_match.py: a bet of the tree's own amount for one of the street's sizes is read as that size, not
    // swapped for its share of the pot (the heads-up limped pot's 33% flop bet is 1bb, which reads back as 50% of 2bb,
    // more than 15% off 33%, so Advisor._cfg_with_real_sizes built a tree the library doesn't store and every decision
    // after it was solved live). Last, after mw_quick (this edit runs on that one's output); it wraps nothing the others
    // hold.
    from: "import engine.mw_quick; from gto.advisor import Advisor;",
    to: "import engine.mw_quick; import engine.size_match; from gto.advisor import Advisor;",
  },
  {
    // engine/pf_charts.py: the preflop charts as served, repaired. 13 to 19bb play the 20bb game's moves (they played the
    // 100bb charts), and no hand continues less than one it dominates, nor does a premium flat while the next hand down
    // raises; the chart nodes that feed a published flop library spot are left as they were. Between tree_depth and
    // bunching (this edit runs on the bunching edit's output), so its wraps are in place before any request. It wraps
    // nothing bunching holds, and anchoring in front of bunching leaves "import engine.bunching; from gto.advisor import
    // Advisor;" whole for an edit that goes after bunching, whichever of the two runs first.
    from: "import engine.tree_depth; import engine.bunching;",
    to: "import engine.tree_depth; import engine.pf_charts; import engine.bunching;",
  },
  {
    // engine/single_size.py: a request's `single_size` (Study's single-size flop source) reads its flop from the
    // single-size library (the library base's ss_index.json) instead of index.json, its tree the flop's own one size;
    // a request without it is upstream's. Last, after size_match, so it wraps the chain's wrap of Advisor._advise_at
    // (bunching, mw_near, mw_quick; this edit runs on size_match's output).
    from: "import engine.size_match; from gto.advisor import Advisor;",
    to: "import engine.size_match; import engine.single_size; from gto.advisor import Advisor;",
  },
  {
    // A request's `cache_mb` (web/src/features/reports/customRun.ts: a custom flop report's solves): the most the solves
    // kept for reuse may hold while it's answered, below the worker's own 700 MB (cache_mb, set at start), which comes back
    // with the next request that doesn't say. A report solves flop after flop and reuses none of them, so without this its
    // solves would fill the worker's heap to the same 700 MB as a long Study session and push those out. Advisor._keep
    // still keeps the latest two whatever they hold (the flop being read, and the one before).
    from: `+ "    adv = advs.get(st.get('speed'), advs['fast'])\\n"`,
    to:
      `+ "    adv = advs.get(st.get('speed'), advs['fast'])\\n"\n` +
      `             + "    _keep = globals().setdefault('KEEP_MB', adv.cache_mb)\\n"\n` +
      `             + "    _mb = min(_keep, max(64.0, float(st.get('cache_mb') or _keep)))\\n"\n` +
      `             + "    for _a in advs.values(): _a.cache_mb = _mb\\n"`,
  },
  {
    // A library spot's files from the host hosts.json names for its set (scripts/library/assemble.py assign_hosts: the
    // spot directories GitHub Pages can't hold, moved to an R2 bucket; web/src/library/hosts.ts reads the same file for
    // the page). hosts.json is read once, beside the index, the first time a spot's file is asked for (not at start: a
    // library without one costs one 404 then); the index files always come from LIBRARY. Only an https base ending in
    // "/" is taken; anything else, or no file, is LIBRARY. The bucket's CORS policy lets the site's origin read it
    // (docs/DEPLOYMENT.md), which a cross-origin fetch from this cross-origin-isolated worker needs.
    from: "const LIB = new Map();   // path -> Uint8Array (fetched) or a Promise (in flight)",
    to:
      "let HOSTS = null;   // spot -> base, from hosts.json (Lizard: scripts/pyodide/worker-edits.mjs)\n" +
      "let hostsP = null;\n" +
      "function hostsOf(h) {\n" +
      "  const out = Object.create(null);\n" +
      "  if (!h || h.format !== 1 || !h.hosts || !h.sets || typeof h.hosts !== \"object\" || typeof h.sets !== \"object\") return out;\n" +
      "  for (const [s, n] of Object.entries(h.sets)) {\n" +
      "    const b = typeof n === \"string\" && Object.prototype.hasOwnProperty.call(h.hosts, n) ? h.hosts[n] : null;\n" +
      "    if (typeof b === \"string\" && /^https:\\/\\/[^/?#]+\\/[^?#]*\\/$/.test(b)) out[s] = b;\n" +
      "  }\n" +
      "  return out;\n" +
      "}\n" +
      "function hostsReady() {   // (async: before a spot's file is fetched ahead)\n" +
      "  hostsP ??= HOSTS ? Promise.resolve() : fetch(LIBRARY + \"hosts.json\", { cache: \"no-cache\" }).then((r) => r.ok ? r.json() : null)\n" +
      "    .then((h) => { HOSTS ??= hostsOf(h); }, () => { HOSTS ??= hostsOf(null); });\n" +
      "  return hostsP;\n" +
      "}\n" +
      "function libUrl(path) {\n" +
      "  const i = path.indexOf(\"/\");\n" +
      "  if (i <= 0) return LIBRARY + path;\n" +
      "  if (HOSTS === null) {   // (asked before the read above came back: read it now, synchronously)\n" +
      "    try {\n" +
      "      const x = new XMLHttpRequest();\n" +
      "      x.open(\"GET\", LIBRARY + \"hosts.json\", false);\n" +
      "      x.send();\n" +
      "      HOSTS = hostsOf(x.status === 200 ? JSON.parse(x.responseText) : null);\n" +
      "    } catch (e) { HOSTS = hostsOf(null); }\n" +
      "  }\n" +
      "  return (HOSTS[path.slice(0, i)] || LIBRARY) + path;\n" +
      "}\n" +
      "const LIB = new Map();   // path -> Uint8Array (fetched) or a Promise (in flight)",
  },
  {
    // (the hosts edit above: a spot's file fetched ahead from its set's host, once hosts.json is read)
    from: "const p = fetch(LIBRARY + path).then((r) => r.ok ? r.arrayBuffer() : null)",
    to: "const p = (path.indexOf(\"/\") > 0 ? hostsReady() : Promise.resolve()).then(() => fetch(libUrl(path))).then((r) => r.ok ? r.arrayBuffer() : null)",
  },
  {
    // (the hosts edit above: a spot's file read synchronously from its set's host)
    from: 'x.open("GET", LIBRARY + path, false);',
    to: 'x.open("GET", libUrl(path), false);',
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
