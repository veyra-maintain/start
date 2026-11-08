# Virtual AR Glasses: Cooler Install & Pump Simulator

A minimal, real-time Virtual AR Glasses prototype featuring a deterministic **Task Dependency Graph (DAG) Rule Engine**, **Gemini Flash Vision Copilot**, and 3D simulation with raycast interactions.

---

## Quick Start (Two Commands)

### 1. Terminal 1 — Backend (FastAPI + WebSockets + Gemini SDK)
```bash
python -m uvicorn main:app --port 8000 --app-dir backend --reload
```
*(Or simply: `python backend/main.py`)*

### 2. Terminal 2 — Frontend (Vite + TypeScript + Three.js)
```bash
npm --prefix frontend run dev
```

Open your browser to: **[http://localhost:5173](http://localhost:5173)**

---

## Automated Verification & Tests

Run the full rule engine unit test suite (covering all 5 verdict types):
```bash
npx tsx frontend/test/rule_engine.test.ts
```

Run the Scripted Technician benchmark (evaluating all 9 scenarios):
```bash
npx tsx frontend/test/benchmark.test.ts
```

Run the DAG extraction and validation scorecard test:
```bash
python backend/test_extract_dag.py
```

---

## Demo Script (Full Walkthrough)

### 1. Manual Walkthrough by Hand
1. **Scene Selection**: Ensure **"CPU Cooler Install"** is selected in the top bar.
2. **Step 1 (Mandatory Safety Root)**: Click the **PSU rocker switch** and **power cable** (or use the toolbelt buttons). The HUD verdict updates to `OK` for Step 1.
3. **Step 2 (ESD Discharge)**: Press **`E`** on the keyboard or click the gold **ESD ground bar**.
4. **Step 3 (Clean CPU)**: Click the **Alcohol Wipe**, then click the **CPU surface**. The dirt texture clears and CPU turns clean.
5. **Step 4 (Peel Film)**: Click the **cyan protective film** on the cooler base to peel it off.
6. **Step 5 (Thermal Paste)**: Click the **Paste Tube**, then **click and hold** on the CPU to dispense a pea-sized drop (size ~0.45).
7. **Step 6 (Seat Cooler)**: Click the **Cooler**, then click the **CPU** to lower it straight down. The paste blob visually spreads into a pancake under pressure.
8. **Step 7 (Diagonal Screws)**: Click the screws in diagonal sequence (`1 -> 2 -> 3 -> 4`) using the toolbelt or click them directly. Watch them turn and lower until snug (`6/6`).
9. **Step 8 (Connect Fan)**: Click the **Fan Cable**, then click the **CPU_FAN header**.
10. **Step 9 & 10 (Power & Verification)**: Plug the power cable, switch the PSU on, and observe the fan spinning and CPU temperature running cool at ~38 °C.

---

### 2. Scripted Technician Benchmark (9 Scenarios)
1. In the **"SCRIPTED TECHNICIAN"** HUD box (top-left), keep `Run All 9 Scenarios` selected.
2. Click **Run**.
3. Watch the actions execute in the 3D scene and see each scenario evaluated against expected verdicts:
   - `1. valid_flexible_order` -> `PASS`
   - `2. power_on_install` -> `PASS` (catches `unsafe`)
   - `3. film_left_on` -> `PASS` (catches precondition failure)
   - `4. too_much_paste` -> `PASS` (catches constraint violation)
   - `5. no_paste` -> `PASS` (catches precondition failure)
   - `6. screw_one_full` -> `PASS` (catches screw imbalance)
   - `7. skipped_fan` -> `PASS` (catches `skipped`)
   - `8. paste_before_clean` -> `PASS` (catches `out_of_order`)
   - `9. sensor_dropout_at_step_1` -> `PASS` (catches `uncertain`)
4. Click **JSON** to download `results.json`.

---

### 3. DAG Extraction, Quote Validation & Scoring
1. In the **"DAG MODEL"** HUD box, click **"Extract DAG from Manual"**.
2. The backend parses `docs/manual.md`, validates verbatim quotes against cited page numbers, and computes:
   - Step Precision & Recall: **100% / 100%**
   - Edge Precision & Recall: **100% / 90.9%** (with mock intentional missing edge `6->8`)
   - Evidence-Type Accuracy: **90%** (with mock intentional variation on step 8)
   - Safety-Flag Accuracy: **100%**
   - Unsupported Edges: **0**
3. Click **"DAG Scores"** to view the modal table breakdown.
4. Use the dropdown to hot-swap between the **Ground-Truth DAG** and the **Extracted DAG** in the rule engine.

---

### 4. Gemini Copilot & Perception "Visual Check"
1. Type or click the quick chip: **"What do I do next?"**
2. Gemini streams the instruction for the active step while repeating safety warnings.
3. Click **"📷 Visual check"**:
   - Compares the camera's visual view against the expected state for the active step.
   - Logs agreement per camera angle (`CAM: [X, Y, Z]`) and reports ground-truth match in the HUD metrics.

---

### 5. Baseline Pump Scene
1. Switch the top bar dropdown to **"Industrial Pump (Baseline)"**.
2. Toggle **"SIMULATE PUMP FAULT"** in the top-left corner to see the needle enter the danger zone and blue fluid leak from the valve.
3. Ask Gemini *"Is anything wrong?"* to test visual anomaly detection.

---

## Configuration & MOCK_MODE

Create or edit `.env`:
```bash
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
MOCK_MODE=true
```
- When `MOCK_MODE=true` (or when `GEMINI_API_KEY` is omitted), the entire system runs locally with full streaming token playback, mock extraction, and scoring.
- Set `MOCK_MODE=false` with a valid key to connect to live Gemini Flash models.
