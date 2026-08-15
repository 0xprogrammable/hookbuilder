# Preserved economic intent

- The pool uses a 30 bps buy fee and a 90 bps sell fee.
- Only the configured admin may change the sell fee.
- A swap callback may observe the trade and choose a fee, but it must not claim an unbacked currency delta.
- Upgrading repository structure must preserve these economics unless the owner explicitly changes them.
