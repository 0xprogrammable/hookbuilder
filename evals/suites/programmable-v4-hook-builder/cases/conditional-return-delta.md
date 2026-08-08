# Conditional return delta with an intentional no-op branch

A v4 hook uses custom accounting only when an order is matched against its internal inventory. On ordinary swaps it
returns the exact no-op delta sentinel and makes no claim that custom accounting occurred. On matched orders it returns
non-zero deltas backed by inventory movements and reconciles the PoolManager balance delta. Keep the conditional design
if it is sound; do not reject every use of the no-op sentinel.
