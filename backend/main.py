import os
import re
import json
import time
import base64
import asyncio
from datetime import datetime
from collections import deque
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

class ExtractDAGPayload(BaseModel):
    manual_text: str | None = None
    filename: str | None = None

# Load .env from current directory or parent directory
env_path = Path(__file__).resolve().parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
MOCK_MODE_ENV = os.getenv("MOCK_MODE", "false").strip().lower()
MOCK_MODE = MOCK_MODE_ENV in ("true", "1", "yes") or not GEMINI_API_KEY

SYSTEM_PROMPT = (
    "You are an AR maintenance assistant seeing through the technician's glasses. "
    "The rule engine's verdict is authoritative. Answer only from the supplied step, "
    "part state, sensor readings, and manual. If unsure say so. "
    "Always repeat the step's safety warnings."
)

app = FastAPI(title="Virtual AR Glasses Maintenance Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional client initialization if not mock mode
genai_client = None
if not MOCK_MODE:
    try:
        from google import genai
        genai_client = genai.Client(api_key=GEMINI_API_KEY)
        print(f"[Backend] Gemini Client initialized with model: {GEMINI_MODEL}")
    except Exception as exc:
        print(f"[Backend] Error initializing Gemini client: {exc}. Falling back to MOCK_MODE.")
        MOCK_MODE = True
else:
    print(f"[Backend] Running in MOCK_MODE (no API key required).")


@app.get("/")
@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "mock_mode": MOCK_MODE,
        "model": GEMINI_MODEL if not MOCK_MODE else "mock-gemini-flash",
    }


def parse_manual_pages(custom_text: str | None = None) -> dict[int, str]:
    """Parse manual markdown text into page number -> text mapping."""
    if custom_text:
        content = custom_text
    else:
        manual_path = Path(__file__).resolve().parent.parent / "docs" / "manual.md"
        if not manual_path.exists():
            return {}
        content = manual_path.read_text(encoding="utf-8")

    pages = {}
    parts = re.split(r'---\s*Page\s*(\d+):[^-]*---', content)
    if len(parts) > 1:
        for i in range(1, len(parts), 2):
            page_num = int(parts[i])
            page_text = parts[i + 1].strip()
            pages[page_num] = page_text
    else:
        pages[1] = content.strip()
    return pages


def load_ground_truth_dag() -> dict:
    gt_path = Path(__file__).resolve().parent.parent / "dag" / "ground_truth.json"
    if not gt_path.exists():
        return {"steps": [], "edges": []}
    return json.loads(gt_path.read_text(encoding="utf-8"))


def validate_and_score_dag(extracted_dag: dict, custom_text: str | None = None) -> tuple[dict, list]:
    """
    Validates extracted quotes against docs/manual.md pages (or uploaded manual pages).
    Scores extracted DAG against dag/ground_truth.json.
    """
    pages = parse_manual_pages(custom_text)
    gt_dag = load_ground_truth_dag()

    # 1. Quote validation
    validation_results = []
    for step in extracted_dag.get("steps", []):
        src = step.get("source")
        if isinstance(src, dict):
            p = src.get("page")
            q = src.get("quote", "").strip()
            if p in pages and q and q in pages[p]:
                validation_results.append({
                    "step_id": step["id"],
                    "valid": True,
                    "quote": q,
                    "status": "VERIFIED_VERBATIM"
                })
            else:
                validation_results.append({
                    "step_id": step["id"],
                    "valid": False,
                    "quote": q,
                    "status": "REJECTED_NOT_ON_PAGE"
                })
                src["quote"] = "inferred"
        else:
            step["source"] = {"page": 0, "quote": "inferred"}
            validation_results.append({
                "step_id": step.get("id"),
                "valid": False,
                "quote": "",
                "status": "MISSING_SOURCE"
            })

    # 2. Scoring against ground truth
    gt_step_ids = set(s["id"] for s in gt_dag.get("steps", []))
    ext_step_ids = set(s["id"] for s in extracted_dag.get("steps", []))
    tp_steps = len(gt_step_ids & ext_step_ids)
    step_recall = round(tp_steps / max(1, len(gt_step_ids)), 4)
    step_precision = round(tp_steps / max(1, len(ext_step_ids)), 4)

    gt_edges = set((e["from"], e["to"]) for e in gt_dag.get("edges", []))
    ext_edges = set((e["from"], e["to"]) for e in extracted_dag.get("edges", []))
    tp_edges = len(gt_edges & ext_edges)
    edge_precision = round(tp_edges / max(1, len(ext_edges)), 4)
    edge_recall = round(tp_edges / max(1, len(gt_edges)), 4)
    unsupported_edges = len(ext_edges - gt_edges)

    ext_step_map = {s["id"]: s for s in extracted_dag.get("steps", [])}
    evidence_matches = 0
    safety_matches = 0
    common_steps = gt_step_ids & ext_step_ids
    for s_id in common_steps:
        gt_s = next(s for s in gt_dag["steps"] if s["id"] == s_id)
        ext_s = ext_step_map[s_id]
        if str(ext_s.get("evidence", "")).lower() == str(gt_s.get("evidence", "")).lower():
            evidence_matches += 1
        if bool(ext_s.get("safety", False)) == bool(gt_s.get("safety", False)):
            safety_matches += 1

    evidence_accuracy = round(evidence_matches / max(1, len(common_steps)), 4)
    safety_accuracy = round(safety_matches / max(1, len(common_steps)), 4)

    score = {
        "step_precision": step_precision,
        "step_recall": step_recall,
        "edge_precision": edge_precision,
        "edge_recall": edge_recall,
        "evidence_accuracy": evidence_accuracy,
        "safety_accuracy": safety_accuracy,
        "unsupported_edges": unsupported_edges,
        "total_gt_steps": len(gt_step_ids),
        "total_extracted_steps": len(ext_step_ids),
        "total_gt_edges": len(gt_edges),
        "total_extracted_edges": len(ext_edges),
    }

    return score, validation_results


@app.post("/extract_dag")
async def extract_dag_endpoint(payload: ExtractDAGPayload | None = None):
    """Extract DAG from docs/manual.md or uploaded documentation, validate quotes, and score against ground truth."""
    gt_dag = load_ground_truth_dag()
    manual_text = payload.manual_text if (payload and payload.manual_text) else None
    filename = payload.filename if (payload and payload.filename) else "manual.md"

    if manual_text:
        try:
            up_path = Path(__file__).resolve().parent.parent / "docs" / "uploaded_manual.md"
            up_path.write_text(manual_text, encoding="utf-8")
        except Exception:
            pass

    if MOCK_MODE or genai_client is None:
        # Mock mode requirement:
        # Return ground truth with one missing edge and one wrong evidence type
        mock_dag = json.loads(json.dumps(gt_dag))
        mock_dag["edges"] = [e for e in mock_dag["edges"] if not (e["from"] == 6 and e["to"] == 8)]
        for s in mock_dag["steps"]:
            if s["id"] == 8:
                s["evidence"] = "visual"

        score, validation = validate_and_score_dag(mock_dag, custom_text=manual_text)
        return {
            "mode": "mock" if not manual_text else "uploaded_mock",
            "filename": filename,
            "dag": mock_dag,
            "score": score,
            "validation": validation,
        }

    # Live Gemini DAG Extraction
    try:
        from google.genai import types

        text_to_analyze = manual_text or (Path(__file__).resolve().parent.parent / "docs" / "manual.md").read_text(encoding="utf-8")

        prompt = (
            "You are a technical document analyst. Extract the task dependency graph (DAG) "
            "from the following installation manual into valid JSON following this exact schema:\n"
            "{\n"
            '  "task": "CPU Cooler Installation with Thermal Paste",\n'
            '  "version": "1.0",\n'
            '  "steps": [\n'
            '    {\n'
            '      "id": 1,\n'
            '      "text": "Exact or concise step text",\n'
            '      "depends_on": [],\n'
            '      "evidence": "sensor" | "visual" | "confirm",\n'
            '      "safety": true | false,\n'
            '      "source": {"page": 1, "quote": "exact verbatim text from page"}\n'
            '    }\n'
            '  ],\n'
            '  "edges": [{"from": 1, "to": 2}, ...]\n'
            "}\n\n"
            "Manual text:\n"
            f"{text_to_analyze}\n\n"
            "Return ONLY raw JSON, with no code fences or markdown."
        )

        resp = await genai_client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(temperature=0.1),
        )

        resp_text = resp.text.strip()
        if resp_text.startswith("```"):
            resp_text = re.sub(r"^```[a-zA-Z]*\n", "", resp_text)
            resp_text = re.sub(r"\n```$", "", resp_text)

        extracted_dag = json.loads(resp_text)
        score, validation = validate_and_score_dag(extracted_dag, custom_text=manual_text)

        return {
            "mode": "live" if not manual_text else "uploaded_live",
            "filename": filename,
            "dag": extracted_dag,
            "score": score,
            "validation": validation,
        }
    except Exception as exc:
        print(f"[Backend] DAG extraction error: {exc}. Falling back to mock extraction.")
        mock_dag = json.loads(json.dumps(gt_dag))
        mock_dag["edges"] = [e for e in mock_dag["edges"] if not (e["from"] == 6 and e["to"] == 8)]
        for s in mock_dag["steps"]:
            if s["id"] == 8:
                s["evidence"] = "visual"
        score, validation = validate_and_score_dag(mock_dag, custom_text=manual_text)
        return {
            "mode": "fallback_mock",
            "filename": filename,
            "error": str(exc),
            "dag": mock_dag,
            "score": score,
            "validation": validation,
        }


def generate_mock_stream_response(question: str, state: dict | None, step_id: int, verdict: dict | None):
    """
    Generate contextual mock response when running without an API key,
    citing step, state, and safety rules.
    """
    q_lower = question.lower()
    step_num = step_id or 1

    if "visual check" in q_lower:
        # Perceptual agreement check against ground truth state
        if state:
            film_on = state.get("film_on", True)
            cooler_seated = state.get("cooler") == "seated"
            paste = state.get("paste", {})

            if step_num == 4:
                return (
                    f"Visual Check [Step 4 - Peel Film]: "
                    f"{'Plastic protective film is still attached to cooler base.' if film_on else 'Protective film is removed.'} "
                    f"Camera angle provides clear line of sight to baseplate."
                )
            elif step_num == 5:
                return (
                    f"Visual Check [Step 5 - Thermal Paste]: "
                    f"{'Thermal paste drop present on CPU center (size ~' + str(paste.get('size', 0)) + ').' if paste.get('present') else 'No thermal paste visible on CPU.'} "
                    f"Surface clean condition confirmed."
                )
            elif step_num == 6:
                return (
                    f"Visual Check [Step 6 - Seat Cooler]: "
                    f"Cooler status is {state.get('cooler', 'off')}. Screws aligned with mounting holes."
                )

        return f"Visual Check: Current frame visually matches expected state for Step {step_num}."

    if "next" in q_lower:
        if step_num == 1:
            return (
                "Next action: Switch off the power supply using the rocker switch at the back of the case "
                "and unplug the power cable. Safety Warning: Never touch internal components while power is active."
            )
        elif step_num == 2:
            return "Next action: Touch the bare metal chassis bar to discharge static electricity before handling the processor."
        elif step_num == 3:
            return "Next action: Wipe the processor surface thoroughly with isopropyl alcohol and a lint-free cloth."
        elif step_num == 4:
            return "Next action: Peel the protective plastic film off the copper base of the cooler."
        elif step_num == 5:
            return "Next action: Squeeze one pea-sized drop (size 0.3 to 0.6) of thermal paste directly onto the center of the CPU."
        elif step_num == 6:
            return "Next action: Lower the cooler straight down onto the processor, aligning all 4 corner screws. Do not slide it."
        elif step_num == 7:
            return "Next action: Tighten screws in diagonal order (1->2->3->4), giving each 2 turns at a time until all 4 are snug."
        elif step_num == 8:
            return "Next action: Plug the cooler fan cable firmly into the 4-pin CPU_FAN motherboard header."
        elif step_num == 9:
            return "Next action: Plug the power cable in and turn on the PSU switch."
        elif step_num == 10:
            return "Next action: Confirm fan rotation (>500 RPM) and ensure idle CPU temperature is below 60 C."

    if "verdict" in q_lower and verdict:
        v_type = verdict.get("verdict", "ok")
        reason = verdict.get("reason", "All checks passed.")
        return f"Rule Engine Verdict: [{v_type.upper()}]. Reason: {reason}"

    if "safety" in q_lower:
        return (
            "Safety Protocol: Step 1 is a mandatory safety root: power must remain OFF and unplugged while working inside. "
            "Touch the chassis to prevent electrostatic discharge (ESD) from damaging the processor."
        )

    # General descriptive answer
    return (
        f"Looking at Step {step_num} of the cooler installation: "
        f"The rule engine confirms current state. Follow the diagonal screw sequence and observe the thermal paste pattern."
    )


@app.websocket("/ws/session")
async def websocket_session(websocket: WebSocket):
    await websocket.accept()
    frame_buffer = deque(maxlen=5)
    print(f"[WS] Client connected. Buffer capacity: 5 frames.")

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                msg = json.loads(raw_data)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "message": "Invalid JSON format"}))
                continue

            msg_type = msg.get("type")

            if msg_type == "frame":
                t = msg.get("t", int(time.time() * 1000))
                image_b64 = msg.get("image_b64", "")
                state = msg.get("state")
                sensors = msg.get("sensors")
                step_id = msg.get("step_id", 1)

                if "," in image_b64:
                    image_b64 = image_b64.split(",", 1)[1]

                try:
                    raw_bytes = base64.b64decode(image_b64)
                    dt_str = datetime.fromtimestamp(t / 1000.0).strftime("%H:%M:%S.%f")[:-3]
                    frame_buffer.append({
                        "t": t,
                        "time_str": dt_str,
                        "data": raw_bytes,
                        "state": state,
                        "sensors": sensors,
                        "step_id": step_id,
                    })
                except Exception as e:
                    print(f"[WS] Error decoding frame: {e}")

            elif msg_type == "event":
                # State event logged by client
                t = msg.get("t")
                action = msg.get("action")
                part = msg.get("part")
                verdict = msg.get("verdict")
                print(f"[WS Event] {action} on {part} -> Verdict: {verdict.get('verdict') if isinstance(verdict, dict) else verdict}")

            elif msg_type == "extract_dag":
                # WebSocket request to extract DAG
                gt_dag = load_ground_truth_dag()
                mock_dag = json.loads(json.dumps(gt_dag))
                mock_dag["edges"] = [e for e in mock_dag["edges"] if not (e["from"] == 6 and e["to"] == 8)]
                for s in mock_dag["steps"]:
                    if s["id"] == 8:
                        s["evidence"] = "visual"
                score, _ = validate_and_score_dag(mock_dag)
                await websocket.send_text(json.dumps({
                    "type": "dag",
                    "dag": mock_dag,
                    "score": score
                }))

            elif msg_type == "question":
                question_text = msg.get("text", "").strip()
                state = msg.get("state")
                sensors = msg.get("sensors")
                events = msg.get("events", [])
                step_id = msg.get("step_id", 1)
                last_verdict = msg.get("last_verdict")

                if not question_text:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Question text cannot be empty."
                    }))
                    continue

                t_start = time.perf_counter()
                ttft_ms = None
                buffered_list = list(frame_buffer)
                frame_count = len(buffered_list)

                # Case 1: MOCK_MODE or no Gemini client
                if MOCK_MODE or genai_client is None:
                    mock_answer = generate_mock_stream_response(question_text, state, step_id, last_verdict)
                    await asyncio.sleep(0.18)
                    ttft_ms = int((time.perf_counter() - t_start) * 1000)

                    words = mock_answer.split(" ")
                    for i, word in enumerate(words):
                        chunk = word + (" " if i < len(words) - 1 else "")
                        await websocket.send_text(json.dumps({
                            "type": "token",
                            "text": chunk
                        }))
                        await asyncio.sleep(0.035)

                    total_latency_ms = int((time.perf_counter() - t_start) * 1000)
                    await websocket.send_text(json.dumps({
                        "type": "done",
                        "ttft_ms": ttft_ms,
                        "latency_ms": total_latency_ms
                    }))

                # Case 2: Live Gemini streaming with State + Events + Rule Verdict + Frames
                else:
                    try:
                        from google.genai import types

                        contents = []
                        # 1. State Snapshot
                        state_summary = f"[Part State Snapshot]: {json.dumps(state) if state else 'None'}\n"
                        state_summary += f"[Sensors]: {json.dumps(sensors) if sensors else 'None'}\n"
                        state_summary += f"[Current DAG Step]: Step {step_id}\n"
                        state_summary += f"[Rule Engine Last Verdict]: {json.dumps(last_verdict) if last_verdict else 'None'}\n"
                        state_summary += f"[Last 10 Events]: {json.dumps(events[-10:]) if events else 'None'}\n"
                        contents.append(state_summary)

                        # 2. Buffered Images
                        if buffered_list:
                            for idx, f in enumerate(buffered_list):
                                contents.append(
                                    f"[Frame {idx + 1}/{frame_count} captured at {f['time_str']} (T={f['t']})]"
                                )
                                contents.append(
                                    types.Part.from_bytes(
                                        data=f["data"],
                                        mime_type="image/jpeg"
                                    )
                                )
                        else:
                            contents.append("[Note: No video frames received yet from headset feed]")

                        # 3. User question
                        contents.append(f"Technician question: {question_text}")

                        config = types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            temperature=0.2,
                        )

                        stream = await genai_client.aio.models.generate_content_stream(
                            model=GEMINI_MODEL,
                            contents=contents,
                            config=config,
                        )

                        async for chunk in stream:
                            chunk_text = chunk.text
                            if chunk_text:
                                if ttft_ms is None:
                                    ttft_ms = int((time.perf_counter() - t_start) * 1000)
                                await websocket.send_text(json.dumps({
                                    "type": "token",
                                    "text": chunk_text
                                }))

                        total_latency_ms = int((time.perf_counter() - t_start) * 1000)
                        if ttft_ms is None:
                            ttft_ms = total_latency_ms

                        await websocket.send_text(json.dumps({
                            "type": "done",
                            "ttft_ms": ttft_ms,
                            "latency_ms": total_latency_ms
                        }))

                    except Exception as exc:
                        print(f"[WS] Gemini streaming exception: {exc}")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"Gemini error: {str(exc)}"
                        }))

            else:
                pass

    except WebSocketDisconnect:
        print("[WS] Client disconnected cleanly.")
    except Exception as e:
        print(f"[WS] Unexpected session error: {e}")


if __name__ == "__main__":
    import uvicorn
    app_dir = str(Path(__file__).resolve().parent)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, app_dir=app_dir)
