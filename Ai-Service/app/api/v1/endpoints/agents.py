"""
Agents Endpoint - AI Agent Workforce execution.
GET  /api/v1/agents       - List available agents
POST /api/v1/agents/execute - Execute a specific agent
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.agent_service import execute_agent, list_agents

router = APIRouter()


class AgentExecuteRequest(BaseModel):
    agent_id: str = Field(..., description="Agent identifier: 'knowledge' | 'engineering' | 'task'")
    query: str = Field(..., min_length=1, max_length=2000, description="Task or question for the agent")


@router.get("/agents")
async def get_agents():
    """Return metadata for all available AI agents."""
    return {
        "agents": list_agents(),
        "count": len(list_agents()),
    }


@router.post("/agents/execute")
async def execute_agent_endpoint(request: AgentExecuteRequest):
    """Execute a specific AI agent with a query."""
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    result = execute_agent(request.agent_id, request.query)

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    return result
