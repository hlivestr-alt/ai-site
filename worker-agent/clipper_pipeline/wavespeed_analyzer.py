from __future__ import annotations
import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import quote, urlsplit
from .analyzer import CANDIDATE_SCHEMA, POLICY
from .common import PipelineError
from .selection import validate_candidate

BASE_URL = "https://llm.wavespeed.ai/v1"
MAX_RESPONSE_BYTES = 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def urlopen(request, timeout):
    # Do not forward the provider credential through an HTTP redirect.
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON property")
        result[key] = value
    return result


def strict_json(value):
    return json.loads(value, object_pairs_hook=unique_object, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON number")))


def token_count(usage, name):
    value = usage.get(name, 0)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 9007199254740991:
        raise PipelineError("ANALYZER_INVALID_OUTPUT")
    return value


class WaveSpeedTranscriptAnalyzer:
    """WaveSpeed Chat Completions JSON mode, with independent local validation.

    The selected model must support JSON mode; rejection is an error, never a
    protocol/model fallback. No video, image bytes, keys, or raw responses are saved.
    """
    def __init__(self, expected_model=None):
        self.key = os.getenv("WAVESPEED_API_KEY", "").strip()
        self.model = os.getenv("WAVESPEED_CLIP_MODEL", "")
        base = os.getenv("WAVESPEED_LLM_BASE_URL") or BASE_URL
        try:
            parsed = urlsplit(base)
            if base.rstrip("/") != BASE_URL or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError()
        except ValueError:
            raise PipelineError("ANALYZER_NOT_CONFIGURED") from None
        if not self.key or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}", self.model):
            raise PipelineError("ANALYZER_NOT_CONFIGURED")
        if expected_model and expected_model != self.model:
            raise PipelineError("ANALYZER_MODEL_MISMATCH")
        self.base = BASE_URL

    def request(self, path, payload=None, *, expected_status=None):
        request = urllib.request.Request(self.base + path, data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode() if payload is not None else None, method="POST" if payload is not None else "GET", headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=60) as response:
                if expected_status is not None and response.status != expected_status:
                    raise PipelineError("ANALYZER_INVALID_OUTPUT")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES or self.key.encode() in raw:
                raise PipelineError("ANALYZER_INVALID_OUTPUT")
            return strict_json(raw)
        except urllib.error.HTTPError as exc:
            code = "ANALYZER_RATE_LIMIT" if exc.code == 429 else "ANALYZER_MODEL_UNAVAILABLE" if exc.code == 404 else "ANALYZER_UNAVAILABLE"
            raise PipelineError(code, exc.code == 429 or exc.code >= 500) from None
        except (TimeoutError, urllib.error.URLError):
            raise PipelineError("ANALYZER_TIMEOUT", True) from None
        except (ValueError, KeyError, TypeError, UnicodeError):
            raise PipelineError("ANALYZER_INVALID_OUTPUT") from None

    def model_available(self):
        data = self.request("/models", expected_status=200)
        models = data.get("data") if isinstance(data, dict) else None
        if isinstance(models, list) and all(isinstance(model, dict) and isinstance(model.get("id"), str) and model["id"] for model in models):
            return any(model["id"] == self.model for model in models)
        # The authenticated list can return data:null for an accessible model.
        # The constructor validates the ID; quote preserves only its vendor slash.
        try:
            exact = self.request("/models/" + quote(self.model, safe="/"), expected_status=200)
        except PipelineError as error:
            if error.code == "ANALYZER_MODEL_UNAVAILABLE":
                return False
            raise
        if not isinstance(exact, dict) or not isinstance(exact.get("id"), str) or "object" in exact and exact["object"] != "model":
            raise PipelineError("ANALYZER_INVALID_OUTPUT")
        return exact["id"] == self.model

    def analyze(self, request: dict) -> dict:
        payload = {"model": self.model, "stream": False, "max_tokens": 4000, "response_format": {"type": "json_object"}, "messages": [
            {"role": "system", "content": POLICY + "\nReturn only a JSON object conforming exactly to this schema:\n" + json.dumps(CANDIDATE_SCHEMA)},
            {"role": "user", "content": json.dumps(request, ensure_ascii=False, allow_nan=False)},
        ]}
        data = self.request("/chat/completions", payload)
        try:
            if not isinstance(data, dict) or data.get("model") != self.model:
                raise PipelineError("ANALYZER_MODEL_MISMATCH")
            choices = data["choices"]
            if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
                raise PipelineError("ANALYZER_INVALID_OUTPUT")
            choice = choices[0]
            if choice.get("finish_reason") != "stop":
                raise PipelineError("ANALYZER_INCOMPLETE")
            message = choice["message"]
            if message.get("refusal") or message.get("tool_calls"):
                raise PipelineError("ANALYZER_REFUSED")
            parsed = strict_json(message["content"])
            if not isinstance(parsed, dict) or set(parsed) != {"candidates"} or not isinstance(parsed["candidates"], list) or len(parsed["candidates"]) > 20:
                raise PipelineError("ANALYZER_INVALID_OUTPUT")
            # All fields, finite numbers, source/chunk timestamps, duration, score,
            # text lengths, and tag bounds are checked before caching or rendering.
            candidates = [validate_candidate(value, request["chunk"]["end"], request, request["chunk"]) for value in parsed["candidates"]]
            if any(value is None for value in candidates):
                raise PipelineError("ANALYZER_INVALID_CANDIDATES")
            usage = data.get("usage") or {}
            if not isinstance(usage, dict):
                raise PipelineError("ANALYZER_INVALID_OUTPUT")
            return {"candidates": candidates, "usage": {"inputTokens": token_count(usage, "prompt_tokens"), "outputTokens": token_count(usage, "completion_tokens"), "requestCount": 1}, "modelVersion": self.model}
        except (ValueError, KeyError, TypeError, AttributeError):
            raise PipelineError("ANALYZER_INVALID_OUTPUT") from None
