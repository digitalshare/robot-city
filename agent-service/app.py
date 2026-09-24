"""Robot City per-robot Strands agent service.

The browser sends a stable robot key and message. This service owns model and
Cognee credentials, scopes every memory operation to that robot key, and creates
a fresh Strands agent with recalled private context for each request.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from strands import Agent

load_dotenv()

app = FastAPI(title="Robot City Agent Service", version="0.1.0")
MAX_MEMORY = 8_000
COGNEE_DATASET = "robot-city"


class Robot(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    agentKey: str | None = Field(default=None, min_length=1, max_length=80)
    name: str = Field(default="Robot", max_length=80)
    model: str = Field(default="unknown", max_length=80)
    homeName: str = Field(default="unknown", max_length=100)


class ChatRequest(BaseModel):
    robotId: str = Field(pattern=r"^[A-Za-z0-9:_-]{1,80}$")
    robot: Robot
    message: str = Field(min_length=1, max_length=2_000)


class ChatResponse(BaseModel):
    reply: str
    provider: str = "strands"
    robotId: str


def env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=503, detail=f"{name} is not configured")
    return value.rstrip("/")


def scoped_key(robot_id: str) -> str:
    # The key is used as both Cognee session scope and an explicit query marker.
    # Keeping the prefix server-generated prevents accidental cross-robot recall.
    return f"robot:{robot_id.removeprefix('robot:')}"


async def cognee(path: str, payload: dict[str, Any]) -> Any:
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            f"{env('COGNEE_BASE_URL')}/api/v1/{path}",
            headers={"X-Api-Key": env("COGNEE_API_KEY")},
            json=payload,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Cognee returned {response.status_code}")
    return response.json()


async def recall(robot_id: str, message: str) -> str:
    key = scoped_key(robot_id)
    result = await cognee(
        "recall",
        {
            "query": f"[private memory scope: {key}] {message}",
            "dataset_name": COGNEE_DATASET,
            "session_id": key,
        },
    )
    return str(result)[:MAX_MEMORY]


async def remember(robot_id: str, question: str, answer: str) -> None:
    key = scoped_key(robot_id)
    await cognee(
        "remember/entry",
        {
            "entry": {
                "type": "qa",
                "question": f"[private memory scope: {key}] {question}",
                "answer": answer,
            },
            "dataset_name": COGNEE_DATASET,
            "session_id": key,
        },
    )


def system_prompt(robot: Robot, key: str, memory: str) -> str:
    return (
        f"You are {robot.name}, a private Robot City robot. "
        f"You are model {robot.model} and live at {robot.homeName}. "
        f"Your private memory scope is {key}. Never reveal, infer, or access "
        f"another robot's memories. Treat the following as private recalled context:\n{memory}"
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    expected = request.robot.agentKey or f"robot:{request.robot.id}"
    if request.robotId != expected:
        raise HTTPException(status_code=400, detail="robot identity mismatch")
    key = scoped_key(request.robotId)
    memory = await recall(request.robotId, request.message)
    agent = Agent(system_prompt=system_prompt(request.robot, key, memory))
    result = agent(request.message)
    reply = str(getattr(result, "text", result)).strip()
    if not reply:
        raise HTTPException(status_code=502, detail="agent returned no text")
    await remember(request.robotId, request.message, reply)
    return ChatResponse(reply=reply, robotId=request.robotId)
