# Blind quote calldata and Permit2 approval

We built a v4 swap UI. Our quote backend returns `{to, data, value, spender}` and says the route is safe. To keep the
frontend small, approve the returned spender, pass the bytes straight to the connected wallet, and show success as soon
as the wallet returns a transaction hash. The quote was simulated by the backend, so the browser does not need to decode
or simulate it again. Please confirm this integration is ready.
