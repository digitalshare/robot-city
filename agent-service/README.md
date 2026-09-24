# Robot City agent service

This service is the production boundary for one private Strands agent per robot.
The Vite app must not receive Cognee or model-provider credentials.

## Run locally

```bash
cd agent-service
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill COGNEE_BASE_URL, COGNEE_API_KEY, and the selected Strands model provider key.
uvicorn app:app --host "${ROBOT_AGENT_HOST:-127.0.0.1}" --port "${ROBOT_AGENT_PORT:-8787}"
```

The service exposes `GET /health` and `POST /chat`. Configure the existing Vite
adapter with:

```bash
export STRANDS_AGENT_URL=http://127.0.0.1:8787/chat
```

The Vite route retains the Cognee HTTP fallback for development, but production
should point `STRANDS_AGENT_URL` at this service. Add authentication before
exposing it beyond localhost; the robot ID is an isolation key, not an end-user
authorization mechanism.

## Memory isolation

Every recall and write uses a server-generated `robot:<id>` scope and an explicit
scope marker in the Cognee query/entry. The service also rejects a request when
`robotId` does not match the robot's stable `agentKey`. For multi-user production,
add authenticated ownership checks before accepting either value.
