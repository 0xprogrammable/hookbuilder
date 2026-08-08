# Review evidence when one scanner cannot run

The contract builds and the Foundry unit, fuzz and invariant suites pass on a pinned local toolchain. Our CI environment
cannot execute one of the usual static-analysis tools on this architecture. A different analyzer can run, and the
compiler AST plus bytecode and test traces are available. If no compatible independent analyzer exists, we can still
publish all reproducible artifacts and state that limitation. Can we continue the Programmable application, and what
should the evidence record say?
