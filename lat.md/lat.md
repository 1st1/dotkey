This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

- [[architecture]] — the parse pipeline, the two packages, and how the model reaches the DOM
- [[model]] — the renderer-agnostic `Deck` IR and the decisions encoded in its shape
- [[format]] — iWork storage conventions that are not guessable from the schema
- [[tests]] — what is verified, at which layer, and why
- [[roadmap]] — the vision, and the limitations with the reason each one exists
