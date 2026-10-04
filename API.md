# API and MCP server

In dev (`npm run dev`) the Vite server exposes every entry of `FUNCTIONS` in `src/ai/functions.js`
(`/building`, `/space`, `/object`) as an HTTP endpoint and an MCP tool. Nothing is listed by hand:
add a function to the registry and both appear. Calls are relayed to the open Robot City browser tab
(it holds the world and the model key) and run exactly like the typed command.

- `GET  /__api/functions` – list functions and their input schema
- `POST /__api/functions/:id` – body `{"request": "a small observatory"}` → `{status, statusText}`
- `POST /__mcp` – MCP over streamable HTTP (`tools/list`, `tools/call`); tool names come from each
  function's tool (`create_building`, …). Example client config: `{"url": "http://localhost:5173/__mcp"}`

A tab must be open (otherwise 503), and cross-origin requests are rejected. A building stays pending
in the review card until it is confirmed in the browser.
