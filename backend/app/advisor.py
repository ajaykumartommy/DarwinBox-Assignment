"""OpenAI advisory pass, isolated from deterministic write decisions."""

from __future__ import annotations

import json
import os
from typing import Any


def review_migration(schema: dict[str, Any], mappings: list[dict[str, Any]], escalation_count: int) -> tuple[str, str]:
    """Use an LLM to review uncertainty; never let it write records or override policy."""
    if not os.getenv("OPENAI_API_KEY"):
        return "policy", "Rule-based policy agent handled the run. Set OPENAI_API_KEY to enable the OpenAI advisory review pass."
    try:
        from openai import OpenAI

        client = OpenAI()
        prompt = {
            "role": "You are a cautious data-migration advisor.",
            "task": "Review the mapping evidence and existing escalation boundary. Give one concise recommendation. Do not invent fields, transform values, or approve ambiguous cases.",
            "target_schema": schema,
            "mappings": mappings,
            "existing_escalation_count": escalation_count,
        }
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            input=json.dumps(prompt),
        )
        return "openai", response.output_text.strip()[:700] or "OpenAI advisor completed a conservative review."
    except Exception as exc:
        return "policy_fallback", f"OpenAI advisor was unavailable ({type(exc).__name__}); deterministic policy handled the run without broadening autonomy."
