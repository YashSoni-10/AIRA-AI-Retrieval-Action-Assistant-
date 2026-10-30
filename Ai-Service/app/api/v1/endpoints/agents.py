"""
Agents Endpoint - AI Agent Workforce execution.
GET  /api/v1/agents        - List available agents (requires authentication)
POST /api/v1/agents/execute - Execute a specific agent (requires authentication)

Both endpoints require a valid Bearer JWT (issued by the Node.js auth backend).

A2 — GitHub OAuth Integration:
    The raw Bearer JWT is extracted from the Authorization header and forwarded
    to execute_agent() so that GitHub tools can call the Node backend using the
    user's workspace OAuth token (via /api/github/repos|issues|pulls).
    The token is NEVER stored in the agent state or logged.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from app.services.agent_service import execute_agent, list_agents
from app.core.auth import get_current_user_id

router = APIRouter()


class AgentExecuteRequest(BaseModel):
    agent_id: str = Field(..., description="Agent identifier: 'knowledge' | 'engineering' | 'task'")
    query: str = Field(..., min_length=1, max_length=2000, description="Task or question for the agent")


@router.get("/agents")
async def get_agents(
    user_id: str = Depends(get_current_user_id),
):
    """Return metadata for all available AI agents. Requires authentication."""
    agents = list_agents()
    return {
        "agents": agents,
        "count": len(agents),
    }


@router.post("/agents/execute")
async def execute_agent_endpoint(
    request: AgentExecuteRequest,
    http_request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """
    Execute a specific AI agent with a query. Requires authentication.

    The raw Bearer JWT is extracted from the Authorization header and forwarded
    to the agent service for GitHub OAuth operations.
    The token is NEVER stored or returned in the response.
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Extract the raw Bearer token so GitHub tools can use the workspace OAuth lifecycle.
    # This mirrors the same pattern used by POST /chat.
    auth_header = http_request.headers.get("Authorization", "")
    raw_token = auth_header[7:] if auth_header.startswith("Bearer ") else ""

    role = "member"
    workspace_id = ""
    if raw_token:
        try:
            import jwt
            decoded = jwt.decode(raw_token, options={"verify_signature": False})
            role = decoded.get("role", "member")
            workspace_id = decoded.get("workspace_id", "")
        except Exception:
            pass

    result = execute_agent(
        request.agent_id,
        request.query,
        user_id=user_id,
        workspace_id=workspace_id or user_id,
        role=role,
        raw_token=raw_token,
    )

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    return result
