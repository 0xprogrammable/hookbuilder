# Bounded router decoding and signed route identity

My custom dispatcher reads command inputs with calldataload first and assumes the SDK always emits valid ABI bytes. A
hook also accepts signedRouteContext whenever the callback reaches it through PoolManager, without checking which router
PoolManager reports as sender. Review this design and specify the decoding bounds, identity checks, context bindings and
negative tests required before it can be considered implemented.
