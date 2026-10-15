"""Generate the public jingcai （竞彩足球） recommendation artifact.

Runs after the traditional football cycle inside the same workflow.
Best-effort throughout: any failure keeps the previously published
payload and never breaks the football pipeline. Published picks are
frozen against the live API payload (the authoritative published
state), so a recommendation never changes while a fixture is on sale.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.football.discovery import BJ
from src.jingcai import engine
from src.jingcai.discovery import JINGCAI_URL, discover_fixtures

OUTPUT = ROOT / "public/data/jingcai/current.json"
API_URL = "https://dlt-assistant.pages.dev/api/jingcai-current"


def _read(path: Path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _published_payload() -> dict | None:
    """Freeze source: the live API payload, falling back to the file."""
    try:
        request = urllib.request.Request(
            API_URL,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                )
            },
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if isinstance(payload, dict) and payload.get("matches"):
            return payload
    except Exception:
        pass
    return _read(OUTPUT)


def main() -> None:
    now = datetime.now(BJ)
    try:
        matches = discover_fixtures(now)
    except Exception as exc:  # keep the previous payload untouched
        print(f"jingcai_discovery_fallback: {type(exc).__name__}: {str(exc)[:160]}")
        return
    try:
        from src.football.dynamics import enrich_issue

        wrapper = {"matches": matches}
        enriched = enrich_issue(wrapper)
        print(f"jingcai_dynamics: enriched={enriched}/{len(matches)}")
    except Exception as exc:
        print(f"jingcai_dynamics_failed: {type(exc).__name__}: {str(exc)[:120]}")
    source = {
        "name": "澳客网竞彩赛程与固定奖金（与官方同步）",
        "url": JINGCAI_URL,
        "checked_at": now.isoformat(),
    }
    payload = engine.build_payload(matches, now.date().isoformat(), source)
    existing = _published_payload()
    payload["matches"] = engine.freeze_picks(payload["matches"], existing)
    payload["parlays"] = engine.freeze_parlays(payload["parlays"], payload["matches"], existing)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(OUTPUT.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(
        f"jingcai {payload['sale_date']}: matches={len(payload['matches'])}, "
        f"parlays={len(payload['parlays'])}, output={OUTPUT}"
    )


if __name__ == "__main__":
    main()
