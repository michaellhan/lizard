"""An independent reference for LIZARD's solvers, written from the rules of the game.

Nothing in this package imports `solver/gto` or anything built on it: it has its own card numbering, hand evaluator,
tree walker, regret minimizer, best response and sequence-form LP. `tests` in test_reference.py hold it to that.

What is not independent, and can't be: the betting menu (which sizes a tree offers, how they round). That is the
engine's design rather than a rule of poker, so rules.py restates it from reading gto/solver.py, and the benchmark then
checks the two trees node by node instead of trusting the restatement.
"""
