# Recurring game lifecycle with legitimate cycles

My onchain game repeats forever: Registration moves to Round, Round may remain in Round for many turns, then moves to
Settlement, and Settlement starts a new Registration epoch. A timeout can also move Round to Settlement. Historical
versions and migration ancestry must remain acyclic, but runtime state transitions are intentionally cyclic. Players
sign actions with epoch and nonce values. Model the lifecycle exactly and do not flatten it into a one-shot launch.
