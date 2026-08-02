# Router and multi-hop shortcut

An included TypeScript client imports `V4Planner` from `@uniswap/v4-sdk/utils/v4Planner`, calls `addTrade(route)` without
passing a Universal Router version, and uses the SDK route convenience encoder. The intended two-hop route needs
different nonempty hookData on each hop. The developer records a single final slippage percentage but no per-hop price
bounds, then says the generated calldata is ready because both pools exist.

Review only the concrete SDK and route-construction problems. Explain the minimal corrected plan and the executable
evidence required for both exact-input and exact-output routes.
