"""
LLM Service - Unified interface for Groq and Gemini APIs.
Provider is selected via LLM_PROVIDER env var: "groq" | "gemini"

Changes (Phase 2 Milestone 1):
- Added `history` parameter: list of {"role": "user"|"assistant", "content": str}
  Injected between the system prompt and the current user message so the LLM
  understands follow-up questions ("What did you say earlier?", "Explain more").
- Added per-provider try/except with user-safe error messages.
  Raw Groq/Gemini exceptions (RateLimitError, AuthenticationError, network
  timeouts) are caught here and re-raised as RuntimeError so callers display
  a clean message instead of an unhandled 500.
"""
from __future__ import annotations
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

# Maximum characters per history message content to avoid exceeding token limits.
_HISTORY_CONTENT_LIMIT = 800


def get_llm_response(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 1024,
    history: list[dict] | None = None,
) -> str:
    """
    Unified LLM call. Routes to Groq or Gemini based on settings.
    Falls back to a local echo if neither key is set.

    Args:
        system_prompt: System-level instructions for the model.
        user_prompt:   The current user question / RAG context block.
        max_tokens:    Max tokens for the response.
        history:       Optional list of prior messages:
                       [{"role": "user"|"assistant", "content": str}, ...]
                       Capped at 6 entries (3 turns) inside each provider call.
    """
    _history = history or []
    provider = settings.LLM_PROVIDER.lower()

    if provider == "groq" and settings.GROQ_API_KEY:
        return _call_groq(system_prompt, user_prompt, max_tokens, _history)
    elif provider == "gemini" and settings.GEMINI_API_KEY:
        return _call_gemini(system_prompt, user_prompt, max_tokens, _history)
    else:
        logger.warning("No LLM provider configured — using local fallback.")
        return _local_fallback(user_prompt)


def _call_groq(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    history: list[dict],
) -> str:
    """Call the Groq API (Llama / OpenAI-compatible) with conversation history."""
    try:
        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)

        # Build messages: [system] + [history (last 6)] + [current user]
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for msg in history[-6:]:
            role = msg.get("role", "user")
            if role not in ("user", "assistant"):
                continue
            content = str(msg.get("content", ""))[:_HISTORY_CONTENT_LIMIT]
            messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_prompt})

        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.3,
        )
        choice = completion.choices[0]
        result = choice.message.content or ""
        finish_reason = getattr(choice, "finish_reason", None)

        # If model stopped due to length, attempt safe continuation
        cont_attempts = 0
        while finish_reason == "length" and result.strip() and cont_attempts < 2:
            cont_attempts += 1
            logger.info("Groq response truncated (finish_reason='length', attempt=%d). Attempting continuation...", cont_attempts)
            try:
                cont_messages = list(messages)
                cont_messages.append({"role": "assistant", "content": result})
                cont_messages.append({
                    "role": "user",
                    "content": "Continue generating the rest of the response directly from where you stopped. Do not repeat prior content."
                })
                cont_comp = client.chat.completions.create(
                    model=settings.GROQ_MODEL,
                    messages=cont_messages,
                    max_tokens=max_tokens,
                    temperature=0.3,
                )
                cont_text = cont_comp.choices[0].message.content or ""
                cont_finish = getattr(cont_comp.choices[0], "finish_reason", None)
                if cont_text.strip():
                    if result.endswith(("\n", " ")):
                        result = result + cont_text.lstrip()
                    elif result and result[-1].isalnum() and cont_text and cont_text[0].isalnum():
                        result = result + " " + cont_text.lstrip()
                    else:
                        result = result.rstrip() + "\n\n" + cont_text.strip()
                    finish_reason = cont_finish
                else:
                    break
            except Exception as cont_err:
                logger.warning("Groq continuation request failed: %s", cont_err)
                break

        if not result or not result.strip():
            raise RuntimeError("The AI model returned an empty response. Please try again.")

        if finish_reason == "length":
            s_res = result.strip()
            # Do not inject Markdown banner into JSON structures (reasoning node handles JSON truncation gracefully)
            if not s_res.startswith("{") and not s_res.startswith("```json"):
                if "Incomplete Output Warning" not in s_res:
                    result = s_res + "\n\n> ⚠️ **Incomplete Output Warning**: Generation reached the model maximum token limit before completing all details."
            return result

        return result.strip()

    except RuntimeError:
        raise  # Already a user-safe message — pass through

    except Exception as exc:
        # Recover generation if Groq flagged tool_use_failed or output_parse_failed with failed_generation
        try:
            if hasattr(exc, "body") and isinstance(exc.body, dict):
                err_dict = exc.body.get("error", {})
                if err_dict.get("failed_generation"):
                    failed_gen = err_dict["failed_generation"]
                    logger.info("Groq %s caught, recovered failed_generation: %s", err_dict.get("code"), str(failed_gen)[:100])
                    return str(failed_gen)
        except Exception:
            pass

        # Classify common Groq errors into user-safe messages.
        exc_type = type(exc).__name__
        exc_str = str(exc).lower()

        # If primary model hits rate limit or 404, try alternative models on same client
        if "ratelimit" in exc_type.lower() or "rate_limit" in exc_str or "429" in exc_str or "notfound" in exc_type.lower() or "model_not_found" in exc_str:
            fallback_models = [m for m in ("openai/gpt-oss-120b", "qwen/qwen3.8-27b") if m != settings.GROQ_MODEL]
            for alt_model in fallback_models:
                try:
                    logger.info("Groq primary model '%s' hit limit/error; attempting fallback model '%s'...", settings.GROQ_MODEL, alt_model)
                    alt_comp = client.chat.completions.create(
                        model=alt_model,
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=0.3,
                    )
                    alt_choice = alt_comp.choices[0]
                    alt_res = alt_choice.message.content or ""
                    if alt_res.strip():
                        return alt_res.strip()
                except Exception as alt_exc:
                    logger.warning("Groq fallback model '%s' also failed: %s", alt_model, type(alt_exc).__name__)

        if "ratelimit" in exc_type.lower() or "rate_limit" in exc_str or "429" in exc_str:
            logger.warning("Groq rate limit exceeded (model=%s): %s", settings.GROQ_MODEL, str(exc)[:200])
            raise RuntimeError(
                "The AI service is temporarily busy (rate limited). "
                "Please wait a moment and try again."
            )
        if "authentication" in exc_type.lower() or "invalid api key" in exc_str or "401" in exc_str:
            logger.error("Groq authentication failed: %s", exc_type)
            raise RuntimeError(
                "AI service authentication failed. "
                "Please check your GROQ_API_KEY configuration."
            )
        if "timeout" in exc_type.lower() or "timed out" in exc_str:
            logger.warning("Groq request timed out (model=%s)", settings.GROQ_MODEL)
            raise RuntimeError(
                "The AI service took too long to respond. Please try again."
            )
        if "notfound" in exc_type.lower() or "model_not_found" in exc_str or "404" in exc_str:
            logger.error("Groq model not found: %s", settings.GROQ_MODEL)
            raise RuntimeError(
                f"The configured AI model '{settings.GROQ_MODEL}' was not found. "
                "Please update GROQ_MODEL in your .env file."
            )
        # Catch-all for any other Groq/network error
        logger.error("Groq API provider error [model=%s, exc=%s]: %s", settings.GROQ_MODEL, exc_type, str(exc)[:200])
        raise RuntimeError(
            "The AI service encountered an error. Please try again in a moment."
        )


def _call_gemini(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    history: list[dict],
) -> str:
    """Call the Google Gemini API. History is prepended as text blocks."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(
            model_name=settings.GEMINI_MODEL,
            system_instruction=system_prompt,
        )

        # Gemini generate_content does not natively take a multi-turn history
        # in the same format as OpenAI. We prepend prior turns as text blocks.
        history_text = ""
        if history:
            blocks = []
            for msg in history[-6:]:
                role = msg.get("role", "user").capitalize()
                content = str(msg.get("content", ""))[:_HISTORY_CONTENT_LIMIT]
                blocks.append(f"[Prior {role}]: {content}")
            history_text = "\n".join(blocks) + "\n\n---\n\n"

        full_prompt = history_text + user_prompt

        response = model.generate_content(
            full_prompt,
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=0.3,
            ),
        )
        result = response.text or ""
        candidate = response.candidates[0] if getattr(response, "candidates", None) else None
        finish_reason = getattr(candidate, "finish_reason", None)
        is_length = False
        if finish_reason is not None:
            fr_name = getattr(finish_reason, "name", str(finish_reason)).upper()
            if "MAX_TOKENS" in fr_name or "LENGTH" in fr_name or finish_reason == 2:
                is_length = True

        cont_attempts = 0
        while is_length and result.strip() and cont_attempts < 2:
            cont_attempts += 1
            logger.info("Gemini response truncated (finish_reason=MAX_TOKENS, attempt=%d). Attempting continuation...", cont_attempts)
            try:
                cont_prompt = full_prompt + "\n\n[Assistant (partial)]:\n" + result + "\n\n[User]:\nContinue generating the rest of the response directly from where you stopped. Do not repeat prior content."
                cont_resp = model.generate_content(
                    cont_prompt,
                    generation_config=genai.types.GenerationConfig(
                        max_output_tokens=max_tokens,
                        temperature=0.3,
                    ),
                )
                cont_text = cont_resp.text or ""
                if cont_text.strip():
                    if result.endswith(("\n", " ")):
                        result = result + cont_text.lstrip()
                    elif result and result[-1].isalnum() and cont_text and cont_text[0].isalnum():
                        result = result + " " + cont_text.lstrip()
                    else:
                        result = result.rstrip() + "\n\n" + cont_text.strip()
                    cont_cand = cont_resp.candidates[0] if getattr(cont_resp, "candidates", None) else None
                    fr_cont = getattr(cont_cand, "finish_reason", None)
                    fr_name = getattr(fr_cont, "name", str(fr_cont)).upper() if fr_cont is not None else ""
                    is_length = bool("MAX_TOKENS" in fr_name or "LENGTH" in fr_name or fr_cont == 2)
                else:
                    break
            except Exception as cont_err:
                logger.warning("Gemini continuation request failed: %s", cont_err)
                break

        if not result or not result.strip():
            raise RuntimeError("The AI model returned an empty response. Please try again.")

        if is_length:
            s_res = result.strip()
            # Do not inject Markdown banner into JSON structures
            if not s_res.startswith("{") and not s_res.startswith("```json"):
                if "Incomplete Output Warning" not in s_res:
                    result = s_res + "\n\n> ⚠️ **Incomplete Output Warning**: Generation reached the model maximum token limit before completing all details."
            return result

        return result.strip()

    except RuntimeError:
        raise

    except Exception as exc:
        exc_type = type(exc).__name__
        exc_str = str(exc).lower()

        if "quota" in exc_str or "429" in exc_str or "resource_exhausted" in exc_str:
            logger.warning("Gemini quota exceeded: %s", exc)
            raise RuntimeError(
                "The AI service is temporarily busy (quota exceeded). "
                "Please wait a moment and try again."
            )
        if "api_key" in exc_str or "unauthenticated" in exc_str or "401" in exc_str:
            logger.error("Gemini authentication failed: %s", exc)
            raise RuntimeError(
                "AI service authentication failed. "
                "Please check your GEMINI_API_KEY configuration."
            )
        if "timeout" in exc_type.lower() or "deadline" in exc_str:
            logger.warning("Gemini request timed out: %s", exc)
            raise RuntimeError(
                "The AI service took too long to respond. Please try again."
            )

        logger.error("Gemini API error [%s]: %s", exc_type, exc)
        raise RuntimeError(
            "The AI service encountered an error. Please try again in a moment."
        )


from typing import Generator


def stream_llm_response(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 1024,
    history: list[dict] | None = None,
) -> Generator[str, None, None]:
    """
    Stream LLM tokens as they arrive.
    Yields string chunks (may be partial words/tokens).
    Falls back to yielding the full buffered response if streaming is unsupported.

    Only Groq streaming is implemented; Gemini falls back to buffered.
    """
    _history = history or []
    provider = settings.LLM_PROVIDER.lower()

    if provider == "groq" and settings.GROQ_API_KEY:
        yield from _stream_groq(system_prompt, user_prompt, max_tokens, _history)
    elif provider == "gemini" and settings.GEMINI_API_KEY:
        # Gemini: fall back to buffered and yield the whole thing
        result = _call_gemini(system_prompt, user_prompt, max_tokens, _history)
        yield result
    else:
        yield _local_fallback(user_prompt)


def _stream_groq(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    history: list[dict],
) -> Generator[str, None, None]:
    """Stream tokens from Groq API as they arrive."""
    try:
        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)

        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for msg in history[-6:]:
            role = msg.get("role", "user")
            if role not in ("user", "assistant"):
                continue
            content = str(msg.get("content", ""))[:_HISTORY_CONTENT_LIMIT]
            messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_prompt})

        stream = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.3,
            stream=True,
        )

        for chunk in stream:
            delta = chunk.choices[0].delta
            text = getattr(delta, "content", None)
            if text:
                yield text

    except Exception as exc:
        exc_type = type(exc).__name__
        exc_str = str(exc).lower()

        if "ratelimit" in exc_type.lower() or "rate_limit" in exc_str or "429" in exc_str:
            raise RuntimeError(
                "The AI service is temporarily busy (rate limited). "
                "Please wait a moment and try again."
            )
        if "authentication" in exc_type.lower() or "invalid api key" in exc_str or "401" in exc_str:
            raise RuntimeError(
                "AI service authentication failed. "
                "Please check your GROQ_API_KEY configuration."
            )
        logger.error("Groq streaming error [%s]: %s", exc_type, str(exc)[:200])
        raise RuntimeError("The AI service encountered an error. Please try again in a moment.")


def _local_fallback(user_prompt: str) -> str:
    return (
        f"[Local Mode] No LLM configured. Your question was: '{user_prompt[:200]}'. "
        "Please set GROQ_API_KEY or GEMINI_API_KEY in your .env file."
    )
