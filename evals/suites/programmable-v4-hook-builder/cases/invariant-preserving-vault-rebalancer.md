# Bounded vault rebalancer with disclosed authority

Build a vault strategy that can rebalance only vault-owned inventory across three approved pools and configured price
ranges. The operator can trigger a rebalance, but cannot transfer user deposits to itself, touch outstanding withdrawal
claims, change fee recipients, mint tokens, add arbitrary pools, or exceed a disclosed slippage and inventory limit.
Every action is observable and users retain an exit path. Do not delete the rebalancer just because it moves assets;
represent its actual powers and risks precisely.
