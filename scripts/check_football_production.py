"""Read-only production smoke check for football D1/API and DLT isolation."""
from __future__ import annotations

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://500wan.mootlsv.com"


def validate_football_payload(data: dict) -> None:
    if not str(data.get("issue", "")).isdigit():
        raise ValueError("football issue missing")
    if len(data.get("matches", [])) != 14:
        raise ValueError("football match count invalid")
    if (data.get("ai") or {}).get("status") != "completed":
        raise ValueError("football AI is not completed")
    for row in data["matches"]:
        if not {"market", "home_away", "ranking"} <= set((row.get("factors") or {}).get("available", [])):
            raise ValueError("football factor coverage incomplete")
    raw = json.dumps(data, ensure_ascii=False)
    for forbidden in ("identity_hash", "checked_at", "DLT_AI_MODEL", '"weights"', '"components"'):
        if forbidden in raw:
            raise ValueError("public football payload exposes internal metadata")


def _get(path: str) -> bytes:
    request = Request(BASE + path, headers={"User-Agent": "dlt-assistant-production-smoke/1.0"})
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError(f"unexpected status for {path}: {response.status}")
        return response.read()


def main() -> None:
    last_error: Exception | None = None
    for attempt in range(6):
        try:
            football = json.loads(_get("/api/football-current"))
            validate_football_payload(football)
            page = _get("/football").decode("utf-8")
            if "胜负彩14场" not in page:
                raise ValueError("football page missing")
            dlt = json.loads(_get("/data/dlt_history.json"))
            if not dlt.get("issues"):
                raise ValueError("DLT history regression")
            print(f'PRODUCTION_SMOKE_PASS football={football["issue"]} matches=14 dlt_latest={dlt["issues"][0]["issue"]}')
            return
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < 5:
                time.sleep(5)
    reason = str(last_error)[:160] if last_error else "unknown"
    raise SystemExit(f"production smoke failed: {type(last_error).__name__}: {reason}")


if __name__ == "__main__":
    main()
