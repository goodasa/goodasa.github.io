#!/usr/bin/env python3
"""
CHUWI 현황판 전용 로컬 서버

이 스크립트는 dashboard 폴더만 있으면 바로 실행할 수 있게 만들어졌습니다.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import shutil
import socketserver
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
MEMORY_DIR = ROOT_DIR / "memory"
SCHOOL_DIR = ROOT_DIR / "school"
DATA_DIR = ROOT_DIR / "data"
STATE_FILE = DATA_DIR / "studyset_state.json"
FORCE_SELECTION_FILE = MEMORY_DIR / "studyset-force.txt"
LOCAL_SECRET_FILE = ROOT_DIR / "local_secrets.env"
DEFAULT_PORT = 8426
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_SYNC_REPO_URL = "https://github.com/goodasa/goodasa.github.io"
DEFAULT_SYNC_BRANCH = "master"
DEFAULT_SYNC_SOURCE_DIR = "smart-dashboard"
SYNC_TARGETS = (
    {
        "name": "memory",
        "local_dir": MEMORY_DIR,
        "preserved_files": {"studyset-force.txt"},
    },
    {
        "name": "school",
        "local_dir": SCHOOL_DIR,
        "preserved_files": set(),
    },
)
BLOCKED_FILE_NAMES = {"local_secrets.env", ".env", ".env.local"}

META_PATTERN = re.compile(r"^@([a-zA-Z_]+):\s*(.*?)\s*$")
CARD_PATTERN = re.compile(r"^-\s*(.+?)\s*\|\s*(.+?)\s*$")
WORD_HEADER_NAMES = {"단어"}
MEANING_HEADER_NAMES = {"의미"}
PROMPT_HEADER_NAMES = {"프롬프트", "이미지프롬프트", "생성프롬프트", "이미지생성프롬프트"}
IMAGE_HEADER_NAMES = {"도해", "관련이미지", "관련그림", "이미지", "이미지링크", "이미지주소", "그림", "링크"}


class DashboardSyncError(Exception):
    """사용자에게 보여줄 수 있는 동기화 오류."""


class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    """대시보드 폴더를 기준으로 정적 파일과 API를 제공합니다."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".js": "application/javascript",
        ".md": "text/markdown; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self._is_blocked_path():
            self.send_error(404)
            return

        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/studyset-selection":
            self._handle_studyset_selection({})
            return
        if parsed.path == "/api/studyset-watch":
            self._handle_studyset_watch()
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in {"/api/studyset-selection", "/api/memory-sync"}:
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                raise ValueError("payload must be object")
        except Exception:
            self._send_json(
                {
                    "ok": False,
                    "error": "invalid_json",
                    "message": "요청 본문이 올바른 JSON 형식이 아닙니다.",
                },
                status=400,
            )
            return

        if parsed.path == "/api/studyset-selection":
            self._handle_studyset_selection(payload)
            return

        self._handle_memory_sync(payload)

    def _handle_studyset_selection(self, payload: dict):
        try:
            response = build_studyset_selection(payload)
        except Exception as error:  # pragma: no cover - defensive guard
            print(f"[studyset-selection] error: {error}", file=sys.stderr)
            self._send_json(
                {
                    "ok": False,
                    "error": "studyset_selection_failed",
                    "message": "StudySet 선택을 처리하지 못했습니다.",
                },
                status=500,
            )
            return

        self._send_json(response)

    def _handle_memory_sync(self, payload: dict):
        try:
            response = sync_memory_from_github(payload)
        except DashboardSyncError as error:
            self._send_json(
                {
                    "ok": False,
                    "error": "memory_sync_failed",
                    "message": str(error),
                },
                status=400,
            )
            return
        except Exception as error:  # pragma: no cover - defensive guard
            print(f"[memory-sync] error: {error}", file=sys.stderr)
            self._send_json(
                {
                    "ok": False,
                    "error": "memory_sync_failed",
                    "message": "GitHub에서 memory 데이터를 업데이트하지 못했습니다.",
                },
                status=500,
            )
            return

        self._send_json(response)

    def _handle_studyset_watch(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        last_signature = ""
        heartbeat_due = 0.0

        try:
            while True:
                payload = build_studyset_watch_payload()
                signature = payload["signature"]

                if signature != last_signature:
                    self.wfile.write(b"event: studyset-change\n")
                    self.wfile.write(("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode("utf-8"))
                    self.wfile.flush()
                    last_signature = signature
                    heartbeat_due = time.time() + 15
                elif time.time() >= heartbeat_due:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    heartbeat_due = time.time() + 15

                time.sleep(2)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_blocked_path(self) -> bool:
        parsed = urllib.parse.urlparse(self.path)
        clean_path = urllib.parse.unquote(parsed.path).lstrip("/")
        if not clean_path:
            return False
        return Path(clean_path).name in BLOCKED_FILE_NAMES


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CHUWI 스마트 현황판 로컬 서버")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="서버 포트 번호")
    parser.add_argument("--open", action="store_true", help="브라우저를 자동으로 엽니다")
    return parser


def open_dashboard(port: int) -> None:
    url = f"http://127.0.0.1:{port}/index.html"
    print(f"브라우저 열기: {url}")
    webbrowser.open(url)


def build_studyset_selection(payload: dict) -> dict:
    ensure_data_dir()
    load_local_secret_env()

    today_key = sanitize_date(payload.get("date")) or datetime.now().strftime("%Y-%m-%d")
    weekday = normalize_text(payload.get("weekday", ""))
    school_subjects = dedupe_text_list(payload.get("schoolSubjects") or [])
    cram_subjects = dedupe_text_list(payload.get("cramSubjects") or [])

    candidates = scan_memory_candidates()
    if not candidates:
        return {
            "ok": True,
            "date": today_key,
            "selectionSource": "empty",
            "message": "memory 폴더에 사용할 md 파일이 없습니다.",
            "files": [],
        }

    state = load_selection_state()
    force_lines = load_force_selection_lines()
    fingerprint = build_selection_fingerprint(candidates, force_lines)
    context_signature = build_context_signature(today_key, weekday, school_subjects, cram_subjects)
    current = state.get("current") or {}

    if selection_is_reusable(current, today_key, fingerprint, context_signature, candidates):
        reusable = current.copy()
        reusable["ok"] = True
        reusable["selectionSource"] = "cached-" + str(current.get("selectionSource", "unknown"))
        return reusable

    history = state.get("history") or []
    annotated_candidates = annotate_candidates(candidates, school_subjects, cram_subjects, history)

    forced_result = select_with_force_override(annotated_candidates, force_lines)
    if forced_result:
        selected_files = attach_selection_reasons(
            forced_result["files"],
            forced_result["reasons"],
        )
        selection_source = "forced"
        selection_note = forced_result["note"]
    else:
        gemini_result = select_with_gemini(
            candidates=annotated_candidates,
            today_key=today_key,
            weekday=weekday,
            school_subjects=school_subjects,
            cram_subjects=cram_subjects,
            history=history,
        )

        if gemini_result:
            selected_files = attach_selection_reasons(
                gemini_result["files"],
                [gemini_result.get("reason01", ""), gemini_result.get("reason02", "")],
            )
            selection_source = "gemini"
            selection_note = gemini_result["note"]
        else:
            selected_files = attach_selection_reasons(
                select_with_fallback(annotated_candidates),
                [
                    "오늘 일정과 최근 이력을 반영한 우선순위가 높아서 선택했습니다.",
                    "첫 번째 선택과 겹치지 않으면서 복습 가치가 높아서 선택했습니다.",
                ],
            )
            selection_source = "fallback"
            selection_note = "Gemini 선택이 없어서 규칙 기반으로 StudySet을 골랐습니다."

    response = build_selection_response(
        date_key=today_key,
        selection_source=selection_source,
        selection_note=selection_note,
        selected_files=selected_files,
    )

    response["fingerprint"] = fingerprint
    response["contextSignature"] = context_signature
    response["context"] = {
        "weekday": weekday,
        "schoolSubjects": school_subjects,
        "cramSubjects": cram_subjects,
    }
    response["ok"] = True

    save_selection_state(state, response)
    return response


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_local_secret_env() -> None:
    if not LOCAL_SECRET_FILE.exists():
        return

    try:
        content = LOCAL_SECRET_FILE.read_text(encoding="utf-8")
    except OSError:
        return

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def scan_memory_candidates() -> list[dict]:
    if not MEMORY_DIR.exists():
        return []

    results = []
    for path in sorted(MEMORY_DIR.glob("*.md")):
        if path.name.startswith("!"):
            continue
        parsed = parse_memory_file(path)
        if parsed["itemCount"] <= 0:
            continue
        results.append(parsed)
    return results


def split_memory_table_cells(line: str) -> list[str] | None:
    if not (line.startswith("|") and line.endswith("|")):
        return None
    return [cell.strip() for cell in line[1:-1].split("|")]


def normalize_header_name(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip().lower()


def find_header_index(cells: list[str], allowed_names: set[str]) -> int:
    normalized_allowed = {normalize_header_name(name) for name in allowed_names}
    for index, cell in enumerate(cells):
        if normalize_header_name(cell) in normalized_allowed:
            return index
    return -1


def get_memory_header_map(cells: list[str]) -> dict | None:
    word_index = find_header_index(cells, WORD_HEADER_NAMES)
    meaning_index = find_header_index(cells, MEANING_HEADER_NAMES)
    prompt_index = find_header_index(cells, PROMPT_HEADER_NAMES)
    image_index = find_header_index(cells, IMAGE_HEADER_NAMES)

    if word_index < 0 or meaning_index < 0:
        return None

    if image_index < 0 and len(cells) == 3:
        image_index = 2

    return {
        "wordIndex": word_index,
        "meaningIndex": meaning_index,
        "promptIndex": prompt_index,
        "imageIndex": image_index,
    }


def is_markdown_table_separator(cells: list[str]) -> bool:
    if len(cells) < 3:
        return False
    return all(re.fullmatch(r":?-{3,}:?", cell) or cell == "" for cell in cells[:3])


def extract_illustration_value(raw_value: str) -> str:
    value = str(raw_value or "").strip()
    if not value or value == "-":
        return ""

    html_image_match = re.search(r"""<img\b[^>]*\bsrc=["'](.+?)["'][^>]*>""", value, re.IGNORECASE)
    if html_image_match:
        return html_image_match.group(1).strip()

    image_match = re.search(r"!\[[^\]]*\]\((.+?)\)", value)
    if image_match:
        return image_match.group(1).strip()

    return value


def get_cell_value(cells: list[str], index: int) -> str:
    if index < 0 or index >= len(cells):
        return ""
    return cells[index].strip()


def parse_memory_file(path: Path) -> dict:
    metadata = {
        "title": "",
        "subject": path.stem,
        "category": "",
        "tags": [],
        "priority": 5,
        "intervalSeconds": 3,
        "cards": [],
    }

    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        content = ""

    if "# memory deck" not in content.lower():
        return {
            "filename": path.name,
            "relativePath": "./memory/" + path.name,
            "title": path.stem,
            "subject": path.stem,
            "category": "",
            "tags": [],
            "priority": 5,
            "intervalSeconds": 3,
            "itemCount": 0,
            "preview": [],
            "mtime": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        }

    has_memory_table = False
    header_map = None

    for index, raw_line in enumerate(content.splitlines()):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        meta_match = META_PATTERN.match(line)
        if meta_match:
            key = meta_match.group(1).strip().lower()
            value = meta_match.group(2).strip()
            if key == "title":
                metadata["title"] = value
            elif key == "subject":
                metadata["subject"] = value
            elif key == "category":
                metadata["category"] = value
            elif key == "tags":
                metadata["tags"] = [item.strip() for item in value.split(",") if item.strip()]
            elif key == "priority":
                try:
                    metadata["priority"] = max(1, min(10, int(value)))
                except ValueError:
                    pass
            elif key == "interval":
                try:
                    metadata["intervalSeconds"] = max(1, int(float(value)))
                except ValueError:
                    pass
            continue

        cells = split_memory_table_cells(line)
        if cells is not None:
            detected_header_map = get_memory_header_map(cells)
            if detected_header_map:
                has_memory_table = True
                header_map = detected_header_map
                continue
            if has_memory_table and is_markdown_table_separator(cells):
                continue
            if has_memory_table and header_map:
                front = get_cell_value(cells, header_map["wordIndex"])
                back = get_cell_value(cells, header_map["meaningIndex"])
                illustration = extract_illustration_value(get_cell_value(cells, header_map["imageIndex"]))
                if front and back:
                    metadata["cards"].append(
                        {
                            "front": front,
                            "back": back,
                            "illustration": illustration,
                            "id": f"{path.stem}-{index}",
                        }
                    )
                continue

        card_match = CARD_PATTERN.match(line)
        if card_match:
            metadata["cards"].append(
                {
                    "front": card_match.group(1).strip(),
                    "back": card_match.group(2).strip(),
                    "illustration": "",
                    "id": f"{path.stem}-{index}",
                }
            )

    title = metadata["title"] or metadata["subject"] or path.stem
    return {
        "filename": path.name,
        "relativePath": "./memory/" + path.name,
        "title": title,
        "subject": metadata["subject"] or path.stem,
        "category": metadata["category"] or "",
        "tags": metadata["tags"],
        "priority": metadata["priority"],
        "intervalSeconds": metadata["intervalSeconds"],
        "itemCount": len(metadata["cards"]),
        "preview": [card["front"] for card in metadata["cards"][:3]],
        "mtime": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
    }


def sync_memory_from_github(payload: dict) -> dict:
    ensure_data_dir()

    repo_url = str(payload.get("repoUrl") or DEFAULT_SYNC_REPO_URL).strip()
    branch = str(payload.get("branch") or DEFAULT_SYNC_BRANCH).strip() or DEFAULT_SYNC_BRANCH
    source_dir = sanitize_remote_source_dir(payload.get("sourceDir") or DEFAULT_SYNC_SOURCE_DIR)
    owner, repo = parse_github_repo_url(repo_url)

    if not owner or not repo:
        raise DashboardSyncError("GitHub 저장소 주소를 확인해주세요.")

    staging_root = Path(tempfile.mkdtemp(prefix="memory-sync-", dir=str(DATA_DIR)))
    synced_files = 0
    synced_summary: dict[str, int] = {}
    last_error: DashboardSyncError | None = None

    try:
        for target in SYNC_TARGETS:
            target_name = target["name"]
            local_dir = target["local_dir"]
            preserved_files = target["preserved_files"]
            staging_target_dir = staging_root / target_name
            source_candidates = build_source_dir_candidates(source_dir, target_name)
            target_count = 0
            target_last_error: DashboardSyncError | None = None

            for candidate in source_candidates:
                try:
                    target_count = download_github_directory(
                        owner=owner,
                        repo=repo,
                        branch=branch,
                        remote_dir=candidate,
                        local_dir=staging_target_dir,
                        preserved_files=preserved_files,
                    )
                    break
                except DashboardSyncError as error:
                    target_last_error = error
                    shutil.rmtree(staging_target_dir, ignore_errors=True)

            if target_count <= 0:
                raise target_last_error or DashboardSyncError(f"GitHub 저장소에서 가져올 {target_name} 파일이 없습니다.")

            apply_directory_sync(
                staging_dir=staging_target_dir,
                local_dir=local_dir,
                preserved_files=preserved_files,
            )
            synced_summary[target_name] = target_count
            synced_files += target_count
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)

    return {
        "ok": True,
        "repoUrl": repo_url,
        "branch": branch,
        "sourceDir": source_dir,
        "syncedFiles": synced_files,
        "syncedSummary": synced_summary,
        "message": (
            "업데이트 성공: "
            + ", ".join(f"{name} {count}개" for name, count in synced_summary.items())
            + "를 반영했습니다."
        ),
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def sanitize_remote_source_dir(value: str) -> str:
    source_dir = str(value or DEFAULT_SYNC_SOURCE_DIR).strip().strip("/")
    if not source_dir:
        return DEFAULT_SYNC_SOURCE_DIR
    if ".." in source_dir.split("/"):
        raise DashboardSyncError("동기화 경로가 올바르지 않습니다.")
    return source_dir


def build_source_dir_candidates(source_dir: str, target_name: str) -> list[str]:
    base_dir = source_dir.strip("/")
    candidates: list[str] = []

    if base_dir and base_dir not in {target_name, "."}:
        candidates.append(f"{base_dir}/{target_name}")

    candidates.append(target_name)
    candidates.append(f"dashboard/{target_name}")

    deduped = []
    for candidate in candidates:
        cleaned = candidate.strip("/")
        if cleaned and cleaned not in deduped:
            deduped.append(cleaned)
    return deduped


def parse_github_repo_url(repo_url: str) -> tuple[str, str]:
    if not repo_url:
        return "", ""

    parsed = urllib.parse.urlparse(repo_url)
    if parsed.scheme and parsed.netloc:
        if "github.com" not in parsed.netloc.lower():
            return "", ""
        parts = [part for part in parsed.path.strip("/").split("/") if part]
    else:
        parts = [part for part in repo_url.strip("/").split("/") if part]

    if len(parts) < 2:
        return "", ""

    owner = parts[0]
    repo = parts[1].removesuffix(".git")
    return owner, repo


def github_api_json(url: str) -> dict | list:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "CHUWI-Dashboard-Sync",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise DashboardSyncError("GitHub 저장소가 비어 있거나 설정한 memory 경로를 찾지 못했습니다.") from error
        if error.code == 403:
            raise DashboardSyncError("GitHub API 호출 한도에 걸렸습니다. 잠시 후 다시 시도해주세요.") from error
        raise DashboardSyncError(f"GitHub API 요청에 실패했습니다. ({error.code})") from error
    except urllib.error.URLError as error:
        raise DashboardSyncError("GitHub에 연결하지 못했습니다. 네트워크를 확인해주세요.") from error


def download_url_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "CHUWI-Dashboard-Sync"},
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.read()
    except urllib.error.URLError as error:
        raise DashboardSyncError("GitHub 파일 다운로드에 실패했습니다.") from error


def download_github_directory(
    *,
    owner: str,
    repo: str,
    branch: str,
    remote_dir: str,
    local_dir: Path,
    preserved_files: set[str] | None = None,
) -> int:
    preserved_files = preserved_files or set()
    api_url = (
        f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}"
        f"/contents/{urllib.parse.quote(remote_dir, safe='/')}?ref={urllib.parse.quote(branch)}"
    )
    payload = github_api_json(api_url)

    if isinstance(payload, dict):
        payload = [payload]

    if not isinstance(payload, list):
        raise DashboardSyncError("GitHub 응답 형식이 올바르지 않습니다.")

    count = 0
    local_dir.mkdir(parents=True, exist_ok=True)

    for entry in payload:
        entry_type = entry.get("type")
        entry_name = entry.get("name", "")
        entry_path = entry.get("path", "")

        if entry_name in preserved_files or entry_name == ".DS_Store":
            continue

        if entry_type == "dir":
            count += download_github_directory(
                owner=owner,
                repo=repo,
                branch=branch,
                remote_dir=entry_path,
                local_dir=local_dir / entry_name,
                preserved_files=preserved_files,
            )
            continue

        if entry_type != "file":
            continue

        download_url = entry.get("download_url")
        if not download_url:
            continue

        target_path = local_dir / entry_name
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(download_url_bytes(download_url))
        count += 1

    return count


def apply_directory_sync(*, staging_dir: Path, local_dir: Path, preserved_files: set[str] | None = None) -> None:
    preserved_names = preserved_files or set()
    local_dir.mkdir(parents=True, exist_ok=True)
    preserved_payloads: dict[str, bytes] = {}

    for name in preserved_names:
        preserved_path = local_dir / name
        if preserved_path.exists() and preserved_path.is_file():
            preserved_payloads[name] = preserved_path.read_bytes()

    for child in list(local_dir.iterdir()):
        if child.name in preserved_names:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink(missing_ok=True)

    for child in staging_dir.iterdir():
        destination = local_dir / child.name
        if child.is_dir():
            shutil.copytree(child, destination, dirs_exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(child, destination)

    for name, content in preserved_payloads.items():
        (local_dir / name).write_bytes(content)


def load_selection_state() -> dict:
    if not STATE_FILE.exists():
        return {"current": None, "history": []}

    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("invalid state root")
    except Exception:
        return {"current": None, "history": []}

    if not isinstance(data.get("history"), list):
        data["history"] = []
    return data


def save_selection_state(state: dict, current_response: dict) -> None:
    history = state.get("history") or []
    history_entry = {
        "date": current_response["date"],
        "selectionSource": current_response["selectionSource"],
        "selectionNote": current_response.get("selectionNote", ""),
        "files": current_response.get("files", []),
        "context": current_response.get("context", {}),
        "savedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "fingerprint": current_response.get("fingerprint", ""),
        "contextSignature": current_response.get("contextSignature", ""),
    }

    history = [item for item in history if item.get("date") != history_entry["date"]]
    history.append(history_entry)
    history = history[-45:]

    state_payload = {
        "current": {
            "date": current_response["date"],
            "selectionSource": current_response["selectionSource"],
            "selectionNote": current_response.get("selectionNote", ""),
            "files": current_response.get("files", []),
            "context": current_response.get("context", {}),
            "fingerprint": current_response.get("fingerprint", ""),
            "contextSignature": current_response.get("contextSignature", ""),
        },
        "history": history,
    }

    STATE_FILE.write_text(json.dumps(state_payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_memory_fingerprint(candidates: list[dict]) -> str:
    parts = []
    for item in candidates:
        parts.append(
            "|".join(
                [
                    item["filename"],
                    str(item["itemCount"]),
                    str(item["intervalSeconds"]),
                    item["mtime"],
                ]
            )
        )
    return "||".join(parts)


def load_force_selection_lines() -> list[str]:
    if not FORCE_SELECTION_FILE.exists():
        return []

    try:
        content = FORCE_SELECTION_FILE.read_text(encoding="utf-8")
    except OSError:
        return []

    lines = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    return lines


def build_force_selection_signature(force_lines: list[str]) -> str:
    return json.dumps(force_lines, ensure_ascii=False)


def build_selection_fingerprint(candidates: list[dict], force_lines: list[str]) -> str:
    return build_memory_fingerprint(candidates) + "##" + build_force_selection_signature(force_lines)


def build_studyset_watch_payload() -> dict:
    candidates = scan_memory_candidates()
    force_lines = load_force_selection_lines()
    fingerprint = build_memory_fingerprint(candidates)
    forced_signature = build_force_selection_signature(force_lines)

    return {
        "fingerprint": fingerprint,
        "forcedFiles": force_lines,
        "signature": fingerprint + "##" + forced_signature,
        "changedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def build_context_signature(date_key: str, weekday: str, school_subjects: list[str], cram_subjects: list[str]) -> str:
    return json.dumps(
        {
            "date": date_key,
            "weekday": weekday,
            "schoolSubjects": school_subjects,
            "cramSubjects": cram_subjects,
        },
        ensure_ascii=False,
        sort_keys=True,
    )


def selection_is_reusable(
    current: dict,
    date_key: str,
    fingerprint: str,
    context_signature: str,
    candidates: list[dict],
) -> bool:
    if not current:
        return False
    if current.get("date") != date_key:
        return False
    if current.get("fingerprint") != fingerprint:
        return False
    if current.get("contextSignature") != context_signature:
        return False
    if len(current.get("files", [])) < 2:
        return False

    available = {item["filename"] for item in candidates}
    for selected in current.get("files", []):
        if selected.get("filename") not in available:
            return False
    return bool(current.get("files"))


def annotate_candidates(
    candidates: list[dict],
    school_subjects: list[str],
    cram_subjects: list[str],
    history: list[dict],
) -> list[dict]:
    recent_count = {}
    last_selected_map = {}

    for entry in history:
        entry_date = sanitize_date(entry.get("date")) or ""
        for selected in entry.get("files", []):
            filename = selected.get("filename")
            if not filename:
                continue
            recent_count[filename] = recent_count.get(filename, 0) + 1
            last_selected_map[filename] = max(last_selected_map.get(filename, ""), entry_date)

    annotated = []
    for item in candidates:
        subject_tokens = make_subject_tokens(item)
        school_match = any(match_token_set(subject_tokens, normalize_text(subject)) for subject in school_subjects)
        cram_match = any(match_token_set(subject_tokens, normalize_text(subject)) for subject in cram_subjects)
        annotated_item = dict(item)
        annotated_item["recentCount"] = recent_count.get(item["filename"], 0)
        annotated_item["lastSelectedDate"] = last_selected_map.get(item["filename"], "")
        annotated_item["schoolMatch"] = school_match
        annotated_item["cramMatch"] = cram_match
        annotated_item["heuristicScore"] = calculate_heuristic_score(annotated_item)
        annotated.append(annotated_item)

    annotated.sort(key=lambda item: (-item["heuristicScore"], item["filename"]))
    return annotated


def calculate_heuristic_score(item: dict) -> int:
    score = 0
    score += int(item.get("priority", 5)) * 10
    score += min(20, int(item.get("itemCount", 0)))
    if item.get("schoolMatch"):
        score += 28
    if item.get("cramMatch"):
        score += 22
    score -= int(item.get("recentCount", 0)) * 11
    if item.get("lastSelectedDate"):
        score -= 8
    return score


def select_with_force_override(candidates: list[dict], force_lines: list[str]) -> dict | None:
    forced = resolve_forced_candidates(candidates, force_lines)
    if not forced:
        return None

    selected = [forced[0]]
    reasons = ["studyset-force.txt에서 강제 지정했습니다."]

    if len(forced) >= 2:
        selected.append(forced[1])
        reasons.append("studyset-force.txt에서 강제 지정했습니다.")
    else:
        fallback_pool = [item for item in candidates if item["filename"] != forced[0]["filename"]]
        fallback_result = select_with_fallback(fallback_pool)
        second = next(
            (item for item in fallback_result if item["filename"] != forced[0]["filename"]),
            None,
        )
        if second is None and fallback_pool:
            second = fallback_pool[0]
        if second is None:
            second = forced[0]
        selected.append(second)
        reasons.append("강제 지정 파일과 함께 볼 보조 StudySet을 자동으로 골랐습니다.")

    note = "studyset-force.txt에서 지정한 파일을 우선 사용했습니다."
    if len(force_lines) >= 3 and len(forced) >= 2:
        note = "studyset-force.txt에 파일명이 3개 이상 있어서 위에서부터 2개만 사용했습니다."

    return {
        "files": selected[:2],
        "reasons": reasons[:2],
        "note": note,
    }


def resolve_forced_candidates(candidates: list[dict], force_lines: list[str]) -> list[dict]:
    by_name = {item["filename"]: item for item in candidates}
    selected = []
    used = set()

    for raw_name in force_lines:
        candidate_names = [raw_name]
        if not raw_name.lower().endswith(".md"):
            candidate_names.append(raw_name + ".md")

        match = next(
            (
                by_name[name]
                for name in candidate_names
                if name in by_name and name not in used
            ),
            None,
        )

        if match is None:
            continue

        selected.append(match)
        used.add(match["filename"])

    return selected


def select_with_fallback(candidates: list[dict]) -> list[dict]:
    if not candidates:
        return []

    first = candidates[0]
    remaining = []
    first_subject = normalize_text(first.get("subject", ""))

    for item in candidates[1:]:
        adjusted = dict(item)
        if normalize_text(item.get("subject", "")) == first_subject:
            adjusted["heuristicScore"] = adjusted["heuristicScore"] - 9
        if item.get("schoolMatch") == first.get("schoolMatch") and item.get("cramMatch") == first.get("cramMatch"):
            adjusted["heuristicScore"] = adjusted["heuristicScore"] - 4
        remaining.append(adjusted)

    remaining.sort(key=lambda item: (-item["heuristicScore"], item["filename"]))
    second = remaining[0] if remaining else first
    return [first, second]


def select_with_gemini(
    *,
    candidates: list[dict],
    today_key: str,
    weekday: str,
    school_subjects: list[str],
    cram_subjects: list[str],
    history: list[dict],
) -> dict | None:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    model_name = os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    history_summary = build_history_summary(history)
    candidate_summary = []
    for item in candidates:
        candidate_summary.append(
            {
                "filename": item["filename"],
                "subject": item["subject"],
                "category": item.get("category", ""),
                "tags": item["tags"][:4],
                "priority": item["priority"],
                "itemCount": item["itemCount"],
                "intervalSeconds": item["intervalSeconds"],
                "schoolMatch": item["schoolMatch"],
                "cramMatch": item["cramMatch"],
                "recentCount": item["recentCount"],
                "lastSelectedDate": item["lastSelectedDate"],
            }
        )

    prompt = (
        "학생용 대시보드에서 오늘 학습할 StudySet 2개를 고르세요.\n"
        "목표는 랜덤이 아니라 오늘 일정과 최근 이력을 반영한 의미 있는 선택입니다.\n"
        "반드시 서로 다른 파일 2개를 고르세요.\n"
        "우선순위: 오늘 학교/학원 관련 과목, 최근 중복 회피, 복습 가치, 두 세트의 다양성.\n"
        "이유는 각각 24자 이내의 짧은 한국어 문장으로 작성하세요.\n\n"
        f"오늘 날짜: {today_key}\n"
        f"요일: {weekday}\n"
        f"오늘 학교 과목: {', '.join(school_subjects) if school_subjects else '없음'}\n"
        f"오늘 학원 과목: {', '.join(cram_subjects) if cram_subjects else '없음'}\n"
        f"최근 선택 이력 요약: {json.dumps(history_summary, ensure_ascii=False)}\n"
        f"후보 파일 목록: {json.dumps(candidate_summary, ensure_ascii=False)}\n\n"
        "설명 없이 아래 JSON만 출력하세요.\n"
        '{"studyset01_filename":"파일명","studyset02_filename":"파일명","reason01":"이유","reason02":"이유"}'
    )

    request_payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": {
                "type": "object",
                "properties": {
                    "studyset01_filename": {
                        "type": "string",
                        "description": "첫 번째 StudySet으로 고른 후보 파일명입니다.",
                    },
                    "studyset02_filename": {
                        "type": "string",
                        "description": "두 번째 StudySet으로 고른 후보 파일명입니다.",
                    },
                    "reason01": {
                        "type": "string",
                        "description": "첫 번째 선택 이유를 24자 이내 한국어로 적습니다.",
                    },
                    "reason02": {
                        "type": "string",
                        "description": "두 번째 선택 이유를 24자 이내 한국어로 적습니다.",
                    },
                },
                "required": [
                    "studyset01_filename",
                    "studyset02_filename",
                    "reason01",
                    "reason02",
                ],
            },
            "thinkingConfig": {
                "thinkingBudget": 0,
            },
            "temperature": 0.2,
            "maxOutputTokens": 256,
        },
    }

    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        + urllib.parse.quote(model_name, safe="")
        + ":generateContent?key="
        + urllib.parse.quote(api_key, safe="")
    )

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    response_data = None
    last_error = None

    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                response_data = json.loads(response.read().decode("utf-8"))
            break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            should_retry = True
            if isinstance(error, urllib.error.HTTPError) and error.code not in {429, 500, 502, 503, 504}:
                should_retry = False
            if attempt >= 2 or not should_retry:
                break
            time.sleep(1.2 * (attempt + 1))

    if response_data is None:
        if last_error is not None:
            print(f"[studyset-selection] Gemini request failed: {last_error}", file=sys.stderr)
        return None

    text = extract_candidate_text(response_data)
    if not text:
        return None

    try:
        parsed = json.loads(extract_json_text(text))
    except json.JSONDecodeError:
        return None

    first_name = str(parsed.get("studyset01_filename", "")).strip()
    second_name = str(parsed.get("studyset02_filename", "")).strip()
    if not first_name or not second_name or first_name == second_name:
        return None

    by_name = {item["filename"]: item for item in candidates}
    if first_name not in by_name or second_name not in by_name:
        return None

    return {
        "files": [by_name[first_name], by_name[second_name]],
        "note": "Gemini가 오늘 일정과 최근 이력을 바탕으로 StudySet을 골랐습니다.",
        "reason01": str(parsed.get("reason01", "")).strip(),
        "reason02": str(parsed.get("reason02", "")).strip(),
    }


def build_selection_response(
    *,
    date_key: str,
    selection_source: str,
    selection_note: str,
    selected_files: list[dict],
) -> dict:
    response_files = []
    slot_titles = ["StudySet 01", "StudySet 02"]

    for index, item in enumerate(selected_files[:2]):
        response_files.append(
            {
                "slotIndex": index,
                "slotTitle": slot_titles[index],
                "filename": item["filename"],
                "relativePath": item["relativePath"],
                "title": item["title"],
                "subject": item["subject"],
                "category": item.get("category", ""),
                "tags": item.get("tags", []),
                "intervalSeconds": item.get("intervalSeconds", 3),
                "itemCount": item.get("itemCount", 0),
                "reason": item.get("reason", ""),
            }
        )

    return {
        "date": date_key,
        "selectionSource": selection_source,
        "selectionNote": selection_note,
        "files": response_files,
    }


def attach_selection_reasons(files: list[dict], reasons: list[str]) -> list[dict]:
    results = []
    for index, item in enumerate(files[:2]):
        cloned = dict(item)
        cloned["reason"] = reasons[index] if index < len(reasons) else ""
        results.append(cloned)
    return results


def build_history_summary(history: list[dict]) -> list[dict]:
    summary = []
    for entry in history[-7:]:
        summary.append(
            {
                "date": entry.get("date", ""),
                "selectionSource": entry.get("selectionSource", ""),
                "files": [item.get("filename", "") for item in entry.get("files", [])],
            }
        )
    return summary


def extract_candidate_text(response_data: dict) -> str:
    candidates = response_data.get("candidates") or []
    if not candidates:
        return ""

    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    if not parts:
        return ""

    chunks = []
    for part in parts:
        text = str(part.get("text", "")).strip()
        if text:
            chunks.append(text)

    return "\n".join(chunks).strip()


def extract_json_text(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return stripped
    if "```" in stripped:
        stripped = stripped.replace("```json", "```")
        chunks = [chunk.strip() for chunk in stripped.split("```") if chunk.strip()]
        for chunk in chunks:
            if chunk.startswith("{") and chunk.endswith("}"):
                return chunk
    start = stripped.find("{")
    end = stripped.rfind("}")
    if 0 <= start < end:
        return stripped[start : end + 1]
    return stripped


def sanitize_date(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return ""


def dedupe_text_list(values: list[str]) -> list[str]:
    result = []
    seen = set()
    for raw in values:
        text = str(raw).strip()
        if not text:
            continue
        key = normalize_text(text)
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").strip()).lower()


def make_subject_tokens(item: dict) -> set[str]:
    tokens = {
        normalize_text(item.get("subject", "")),
        normalize_text(item.get("title", "")),
        normalize_text(item.get("category", "")),
    }
    for tag in item.get("tags", []):
        tokens.add(normalize_text(tag))
    return {token for token in tokens if token}


def match_token_set(tokens: set[str], target: str) -> bool:
    if not target:
        return False
    for token in tokens:
        if token == target or token in target or target in token:
            return True
    return False


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    os.chdir(ROOT_DIR)

    try:
        server = ThreadingServer(("127.0.0.1", args.port), DashboardHandler)
    except OSError as error:
        print("")
        print("서버를 시작하지 못했습니다.")
        print(f"이유: {error}")
        print("")
        print("다른 프로그램이 같은 포트를 쓰고 있을 수 있습니다.")
        print(f"해결 방법 1: 기존 창을 닫고 다시 실행")
        print(f"해결 방법 2: python serve_dashboard.py --port {args.port + 1}")
        return 1

    url = f"http://127.0.0.1:{args.port}/index.html"
    print("")
    print("CHUWI 스마트 현황판 서버가 시작되었습니다.")
    print(f"폴더 위치: {ROOT_DIR}")
    print(f"주소: {url}")
    print("")
    print("종료하려면 이 창에서 Ctrl + C 를 누르세요.")
    print("")

    if args.open:
        open_dashboard(args.port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("")
        print("서버를 종료합니다.")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
