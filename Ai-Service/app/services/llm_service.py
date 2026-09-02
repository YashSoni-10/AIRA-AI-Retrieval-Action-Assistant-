"""
LLM Service - Unified interface for Groq and Gemini APIs.
Provider is selected via LLM_PROVIDER env var: "groq" | "gemini"
"""
from __future__ import annotations
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)


def get_llm_response(system_prompt: str, user_prompt: str, max_tokens: int = 1024) -> str:
    """
    Unified LLM call. Routes to Groq or Gemini based on settings.
    Falls back to a local echo if neither key is set.
    """
    provider = settings.LLM_PROVIDER.lower()

    if provider == "groq" and settings.GROQ_API_KEY:
        return _call_groq(system_prompt, user_prompt, max_tokens)
    elif provider == "gemini" and settings.GEMINI_API_KEY:
        return _call_gemini(system_prompt, user_prompt, max_tokens)
    else:
        logger.warning("No LLM provider configured — using local fallback.")
        return _local_fallback(user_prompt)


def _call_groq(system_prompt: str, user_prompt: str, max_tokens: int) -> str:
    from groq import Groq
    client = Groq(api_key=settings.GROQ_API_KEY)
    completion = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=0.3,
    )
    return completion.choices[0].message.content.strip()


def _call_gemini(system_prompt: str, user_prompt: str, max_tokens: int) -> str:
    import google.generativeai as genai
    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(
        model_name=settings.GEMINI_MODEL,
        system_instruction=system_prompt,
    )
    response = model.generate_content(
        user_prompt,
        generation_config=genai.types.GenerationConfig(max_output_tokens=max_tokens, temperature=0.3),
    )
    return response.text.strip()


def _local_fallback(user_prompt: str) -> str:
    return (
        f"[Local Mode] No LLM configured. Your question was: '{user_prompt}'. "
        "Please set GROQ_API_KEY or GEMINI_API_KEY in your .env file."
    )
