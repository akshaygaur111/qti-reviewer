# ============================================================
# QTI Smart Tester — Colab Cell
#
# For every item in the uploaded Excel template, this tool:
#
#   Single-choice MCQ  (cardinality=single, base-type=identifier)
#     • Submits the correct choice  → expects isCorrect=true,  score=max
#     • Submits each wrong choice   → expects isCorrect=false, score=0
#       (or the declared mapped value if map_response is used)
#
#   Multi-select MCQ   (cardinality=multiple, base-type=identifier)
#     • Submits every non-empty subset of choices (2^N − 1 combinations)
#     • Expected score per subset is derived from the XML:
#         match_correct → full score only when subset == correct set
#         map_response  → sum of mapped values (clamped by bounds)
#
#   Text / numeric entry  (base-type=string|float|integer)
#     • Submits each value listed in <correctResponse> → expects full score
#     • Submits one clearly-wrong value                → expects score=0
#
#   No blank/empty response tests.
#
# Output Excel (3 sheets):
#   Summary   — one row per item
#   All Tests — one row per individual test case
#   Issues    — FAIL / ERROR rows only
# ============================================================

# -------------------- Install --------------------
import subprocess, sys
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
                       "openpyxl", "requests", "ipywidgets"])

# -------------------- Imports --------------------
import io, json, re, time
from datetime import datetime
from itertools import chain, combinations

import openpyxl
import requests
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from xml.etree import ElementTree as ET

from google.colab import files
import ipywidgets as widgets
from IPython.display import clear_output, display

# -------------------- Constants --------------------
BASE_URL    = "https://qti.alpha-1edtech.ai"
ITEM_URL    = BASE_URL.rstrip("/") + "/api/assessment-items/{id}"
PROCESS_URL = BASE_URL.rstrip("/") + "/api/assessment-items/{id}/process-response"
TEMPLATE_PATH = "qti_smart_template.xlsx"
API_DELAY   = 0.25   # seconds between process-response calls
SCORE_EPS   = 0.001  # tolerance for float score comparison

# -------------------- Excel styles --------------------
_THIN   = Side(style="thin", color="CCCCCC")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_HDR_FONT  = Font(name="Arial", bold=True,  color="FFFFFF", size=10)
_HDR_FILL  = PatternFill("solid", start_color="2E4057")
_INFO_FILL = PatternFill("solid", start_color="EAF0FB")
_EX_FONT   = Font(name="Arial", size=10, color="AAAAAA", italic=True)
_EX_FILL   = PatternFill("solid", start_color="F7F7F7")
_LEFT      = Alignment(horizontal="left",   vertical="center", wrap_text=True)
_CENTER    = Alignment(horizontal="center", vertical="center")
_P_FILL    = PatternFill("solid", start_color="D6F5D6")  # green  – PASS
_F_FILL    = PatternFill("solid", start_color="FFF3CD")  # yellow – FAIL
_E_FILL    = PatternFill("solid", start_color="FFD6D6")  # red    – ERROR


# ================================================================
# XML Parsing
# ================================================================

def _strip_ns(tag: str) -> str:
    return re.sub(r"\{[^}]+\}", "", tag)


def parse_item_info(raw_xml: str):
    """
    Returns (declarations, score_max, error_string).

    Each declaration is a dict:
        identifier          str
        cardinality         'single' | 'multiple' | 'ordered'
        base_type           'identifier' | 'string' | 'float' | 'integer' | …
        correct_values      list[str]   – values from <correctResponse>
        available_choices   list[str]   – choice identifiers from the interaction
        has_mapping         bool
        mapping             dict[str, float]   – mapKey → mappedValue
        mapping_default     float
        mapping_lower_bound float | None
        mapping_upper_bound float | None
    """
    try:
        root = ET.fromstring(raw_xml)
    except ET.ParseError as exc:
        return None, None, f"XML ParseError: {exc}"

    decls = []
    for elem in root.iter():
        if _strip_ns(elem.tag) != "qti-response-declaration":
            continue

        mapping: dict[str, float] = {}
        mapping_default = 0.0
        mapping_lb = None
        mapping_ub = None

        for child in elem.iter():
            ctag = _strip_ns(child.tag)
            if ctag == "qti-mapping":
                raw_lb  = child.attrib.get("lower-bound")
                raw_ub  = child.attrib.get("upper-bound")
                raw_def = child.attrib.get("default-value", "0")
                try: mapping_lb = float(raw_lb) if raw_lb is not None else None
                except ValueError: pass
                try: mapping_ub = float(raw_ub) if raw_ub is not None else None
                except ValueError: pass
                try: mapping_default = float(raw_def)
                except ValueError: pass
            elif ctag == "qti-map-entry":
                key = child.attrib.get("map-key", "")
                try:
                    val = float(child.attrib.get("mapped-value", "0"))
                except ValueError:
                    val = 0.0
                if key:
                    mapping[key] = val

        correct_values = [
            c.text.strip()
            for c in elem.iter()
            if _strip_ns(c.tag) == "qti-value" and c.text and c.text.strip()
        ]

        decls.append({
            "identifier":          elem.attrib.get("identifier", ""),
            "cardinality":         elem.attrib.get("cardinality", "single").lower(),
            "base_type":           elem.attrib.get("base-type", "string").lower(),
            "correct_values":      correct_values,
            "available_choices":   [],
            "has_mapping":         bool(mapping),
            "mapping":             mapping,
            "mapping_default":     mapping_default,
            "mapping_lower_bound": mapping_lb,
            "mapping_upper_bound": mapping_ub,
        })

    if not decls:
        return None, None, "No <qti-response-declaration> elements found in XML"

    # Attach choices to each declaration
    choice_map: dict[str, list[str]] = {}
    for elem in root.iter():
        if _strip_ns(elem.tag) == "qti-choice-interaction":
            rid = elem.attrib.get("response-identifier", "")
            choice_map[rid] = [
                c.attrib["identifier"]
                for c in elem.iter()
                if _strip_ns(c.tag) == "qti-simple-choice"
                and "identifier" in c.attrib
            ]
    for d in decls:
        d["available_choices"] = choice_map.get(d["identifier"], [])

    # SCORE outcome → normalMaximum
    score_max = None
    for elem in root.iter():
        if _strip_ns(elem.tag) == "qti-outcome-declaration":
            if elem.attrib.get("identifier") == "SCORE":
                nm = elem.attrib.get("normal-maximum")
                if nm:
                    try:
                        score_max = float(nm)
                    except ValueError:
                        pass

    return decls, score_max, None


# ================================================================
# Expected-score computation
# ================================================================

def _expected_score_single(choice_id: str, decl: dict, score_max) -> float:
    """Expected score when exactly one choice is submitted (single cardinality)."""
    if decl["has_mapping"]:
        return decl["mapping"].get(choice_id, decl["mapping_default"])
    # match_correct
    return float(score_max or 1) if choice_id in decl["correct_values"] else 0.0


def _expected_score_multiple(subset: tuple, decl: dict, score_max) -> float:
    """Expected score when a subset of choices is submitted (multiple cardinality)."""
    if decl["has_mapping"]:
        raw = sum(decl["mapping"].get(c, decl["mapping_default"]) for c in subset)
        lb = decl["mapping_lower_bound"]
        ub = decl["mapping_upper_bound"]
        if lb is not None:
            raw = max(raw, lb)
        if ub is not None:
            raw = min(raw, ub)
        return round(raw, 6)
    # match_correct: full credit only when subset == correct set exactly
    return float(score_max or 1) if set(subset) == set(decl["correct_values"]) else 0.0


def _expected_is_correct_single(choice_id: str, decl: dict, exp_score, score_max) -> bool:
    """Expected isCorrect for a single-cardinality submission."""
    if decl["has_mapping"]:
        # isCorrect is unreliable for map_response; skip the check
        return None
    return choice_id in decl["correct_values"]


def _expected_is_correct_multiple(subset: tuple, decl: dict, exp_score, score_max) -> bool:
    """Expected isCorrect for a multiple-cardinality submission."""
    if decl["has_mapping"]:
        return None  # unreliable for map_response
    return set(subset) == set(decl["correct_values"])


# ================================================================
# Test-case generation
# ================================================================

def _powerset_nonempty(iterable):
    s = list(iterable)
    return chain.from_iterable(combinations(s, r) for r in range(1, len(s) + 1))


def generate_test_cases(decls: list, score_max) -> list:
    """
    Returns a list of per-interaction test-case dicts.

    Single-choice MCQ (cardinality=single, base-type=identifier):
        • One test per available choice — correct choice first, then each wrong one.

    Multi-select MCQ (cardinality=multiple/ordered, base-type=identifier):
        • All 2^N − 1 non-empty subsets.

    Text / numeric entry (base-type=string|float|integer):
        • Every value listed in <correctResponse> submitted individually.
        • One clearly-wrong value.

    Each dict has keys:
        interaction_id, cardinality, label,
        payload_value (str | list | — single interaction),
        expected_score (float | None),
        expected_is_correct (bool | None),  None = do not verify
        full_payload (False)  — payload built as {interaction_id: payload_value}
    """
    cases = []

    for d in decls:
        rid         = d["identifier"]
        card        = d["cardinality"]
        btype       = d["base_type"]
        correct_set = set(d["correct_values"])
        choices     = d["available_choices"]

        # ------------------------------------------------------------------
        # Choice-based interactions
        # ------------------------------------------------------------------
        if btype == "identifier" and choices:

            if card == "single":
                for choice in choices:
                    exp_score = _expected_score_single(choice, d, score_max)
                    exp_ic    = _expected_is_correct_single(choice, d, exp_score, score_max)
                    is_corr   = choice in correct_set
                    cases.append({
                        "interaction_id":      rid,
                        "cardinality":         card,
                        "label":               f"{'✓' if is_corr else '✗'} '{choice}'",
                        "payload_value":       choice,
                        "expected_score":      exp_score,
                        "expected_is_correct": exp_ic,
                        "full_payload":        False,
                    })

            elif card in ("multiple", "ordered"):
                for subset in _powerset_nonempty(choices):
                    exp_score  = _expected_score_multiple(subset, d, score_max)
                    exp_ic     = _expected_is_correct_multiple(subset, d, exp_score, score_max)
                    subset_set = set(subset)
                    mark = "✓" if subset_set == correct_set else (
                           "~" if subset_set & correct_set else "✗")
                    cases.append({
                        "interaction_id":      rid,
                        "cardinality":         card,
                        "label":               f"{mark} {list(subset)}",
                        "payload_value":       list(subset),
                        "expected_score":      exp_score,
                        "expected_is_correct": exp_ic,
                        "full_payload":        False,
                    })

        # ------------------------------------------------------------------
        # Text / numeric entry  — per-blank individual tests
        # ------------------------------------------------------------------
        else:
            for cv in d["correct_values"]:
                cases.append({
                    "interaction_id":      rid,
                    "cardinality":         card,
                    "label":               f"✓ '{cv}'",
                    "payload_value":       cv,
                    "expected_score":      float(score_max or 1),
                    "expected_is_correct": True,
                    "full_payload":        False,
                })

            wrong = "999999" if btype in ("float", "integer") else "WRONG_ANSWER"
            cases.append({
                "interaction_id":      rid,
                "cardinality":         card,
                "label":               f"✗ '{wrong}'",
                "payload_value":       wrong,
                "expected_score":      0.0,
                "expected_is_correct": False,
                "full_payload":        False,
            })

    return cases


def generate_combination_tests(decls: list, score_max) -> list:
    """
    For items that have 2+ text / numeric entry interactions (multiple blanks
    in the same question), generate combined-payload tests that submit ALL
    blanks at once:

        1. All blanks correct          → expect isCorrect=true, score=score_max
        2. Each blank wrong in turn    → expect isCorrect=false
           (score not asserted — depends on partial-credit template)
        3. All blanks wrong            → expect isCorrect=false, score=0

    Each dict has full_payload=True so the run loop uses payload_value directly
    as the entire {"RESPONSE_1": …, "RESPONSE_2": …} dict.
    """
    text_decls = [
        d for d in decls
        if not (d["base_type"] == "identifier" and d["available_choices"])
    ]

    if len(text_decls) < 2:
        return []   # nothing to combine

    def _first_correct(d):
        return d["correct_values"][0] if d["correct_values"] else "UNKNOWN"

    def _wrong(d):
        return "999999" if d["base_type"] in ("float", "integer") else "WRONG_ANSWER"

    all_correct_payload = {d["identifier"]: _first_correct(d) for d in text_decls}
    all_wrong_payload   = {d["identifier"]: _wrong(d)          for d in text_decls}

    cases = []

    # 1. All blanks correct
    cases.append({
        "interaction_id":      "COMBINED",
        "cardinality":         "combination",
        "label":               "✓ all blanks correct",
        "payload_value":       dict(all_correct_payload),
        "expected_score":      float(score_max or 1),
        "expected_is_correct": True,
        "full_payload":        True,
        "skip_score_check":    False,
    })

    # 2. Each blank wrong individually (others stay correct)
    for d in text_decls:
        rid = d["identifier"]
        payload = dict(all_correct_payload)
        payload[rid] = _wrong(d)
        cases.append({
            "interaction_id":      "COMBINED",
            "cardinality":         "combination",
            "label":               f"✗ blank '{rid}' wrong, rest correct",
            "payload_value":       payload,
            "expected_score":      None,    # partial-credit score unknown without RP parse
            "expected_is_correct": False,
            "full_payload":        True,
            "skip_score_check":    True,    # only verify isCorrect=false
        })

    # 3. All blanks wrong
    cases.append({
        "interaction_id":      "COMBINED",
        "cardinality":         "combination",
        "label":               "✗ all blanks wrong",
        "payload_value":       dict(all_wrong_payload),
        "expected_score":      0.0,
        "expected_is_correct": False,
        "full_payload":        True,
        "skip_score_check":    False,
    })

    return cases


# ================================================================
# API helpers
# ================================================================

def _auth_headers(token: str) -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token.strip()}",
    }


def fetch_item(item_id: str, headers: dict):
    try:
        r = requests.get(ITEM_URL.format(id=item_id), headers=headers, timeout=20)
        if r.status_code == 200:
            return r.json(), None
        return None, f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as exc:
        return None, str(exc)


def call_process(item_id: str, payload: dict, headers: dict):
    try:
        r = requests.post(
            PROCESS_URL.format(id=item_id),
            headers=headers,
            json={"responses": payload},
            timeout=20,
        )
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text[:300]}
        return r.status_code, body, None
    except requests.exceptions.Timeout:
        return None, {}, "Request timed out"
    except Exception as exc:
        return None, {}, str(exc)


# ================================================================
# Evaluation
# ================================================================

def evaluate_case(sc, body: dict, case: dict) -> tuple[str, str, str, str]:
    """
    Returns (status, actual_is_correct, actual_score, detail).
    status ∈ {"PASS", "FAIL", "ERROR"}

    Respects two optional case flags:
        expected_is_correct = None  → skip isCorrect check (map_response items)
        skip_score_check    = True  → skip score assertion (partial-credit combinations)
    """
    exp_score        = case["expected_score"]
    exp_ic           = case["expected_is_correct"]
    skip_score_check = case.get("skip_score_check", False)

    if sc is None:
        return "ERROR", "-", "-", "Network / timeout error"

    if sc == 500:
        detail = body.get("details", body.get("raw", ""))
        return "ERROR", "-", "-", f"500 Server Error — {str(detail)[:250]}"

    if sc not in (200, 201):
        msg = body.get("error", body.get("raw", ""))
        return "FAIL", "-", "-", f"HTTP {sc}: {str(msg)[:200]}"

    actual_ic_raw = body.get("isCorrect")
    actual_sc_raw = body.get("score")

    try:
        actual_score = float(actual_sc_raw) if actual_sc_raw is not None else None
    except (ValueError, TypeError):
        actual_score = None

    problems = []

    # isCorrect — skip when None (map_response / ambiguous)
    if exp_ic is not None and actual_ic_raw != exp_ic:
        problems.append(f"isCorrect: expected={exp_ic}, got={actual_ic_raw}")

    # Score — skip when flagged or expected is None
    if not skip_score_check and exp_score is not None and actual_score is not None:
        if abs(actual_score - exp_score) > SCORE_EPS:
            problems.append(
                f"score: expected={exp_score:.4g}, got={actual_score:.4g}"
            )

    actual_ic_str = str(actual_ic_raw)
    actual_sc_str = str(actual_sc_raw)

    if problems:
        return "FAIL", actual_ic_str, actual_sc_str, " | ".join(problems)

    return "PASS", actual_ic_str, actual_sc_str, f"isCorrect={actual_ic_raw}, score={actual_sc_raw}"


# ================================================================
# Excel helpers
# ================================================================

def _sfill(status: str):
    s = str(status)
    if "PASS"  in s: return _P_FILL
    if "FAIL"  in s: return _F_FILL
    if "ERROR" in s: return _E_FILL
    return None


def _write_header(ws, row_num: int, specs: list):
    for col, label, width in specs:
        c = ws[f"{col}{row_num}"]
        c.value, c.font, c.fill = label, _HDR_FONT, _HDR_FILL
        c.alignment, c.border = _CENTER, _BORDER
        ws.column_dimensions[col].width = width
    ws.row_dimensions[row_num].height = 22


def _write_cell(ws, row: int, col: int, val, fill=None):
    c = ws.cell(row=row, column=col, value=val)
    c.font      = Font(name="Arial", size=9)
    c.alignment = _LEFT
    c.border    = _BORDER
    if fill:
        c.fill = fill
    return c


def build_results_excel(summary_rows: list, detail_rows: list) -> str:
    report = f"qti_smart_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    wb = Workbook()

    # ---- totals ----
    total   = len(summary_rows)
    pass_c  = sum(1 for r in summary_rows if r["overall"] == "✅ PASS")
    fail_c  = sum(1 for r in summary_rows if r["overall"] == "⚠️ FAIL")
    error_c = sum(1 for r in summary_rows if r["overall"] == "❌ ERROR")

    # ------------------------------------------------------------------
    # Sheet 1 — Summary
    # ------------------------------------------------------------------
    ws_sum = wb.active
    ws_sum.title = "Summary"
    ws_sum.freeze_panes = "A4"

    ws_sum.merge_cells("A1:H1")
    ws_sum["A1"].value     = (f"QTI Smart Test Results  |  "
                               f"{datetime.now().strftime('%Y-%m-%d %H:%M')}  |  {BASE_URL}")
    ws_sum["A1"].font      = Font(name="Arial", bold=True, size=12, color="2E4057")
    ws_sum["A1"].alignment = _LEFT
    ws_sum.row_dimensions[1].height = 26

    ws_sum.merge_cells("A2:H2")
    ws_sum["A2"].value     = (f"Items: {total}   ✅ Pass: {pass_c}   "
                               f"⚠️ Fail: {fail_c}   ❌ Error: {error_c}")
    ws_sum["A2"].font      = Font(name="Arial", size=10, italic=True)
    ws_sum["A2"].fill      = _INFO_FILL
    ws_sum["A2"].alignment = _LEFT
    ws_sum.row_dimensions[2].height = 18

    _write_header(ws_sum, 3, [
        ("A", "item_identifier",   26),
        ("B", "overall",           12),
        ("C", "interactions",      14),
        ("D", "total_tests",       12),
        ("E", "passed",            10),
        ("F", "failed",            10),
        ("G", "errors",            10),
        ("H", "notes",             34),
    ])

    for ri, row in enumerate(summary_rows, start=4):
        ov = row["overall"]
        _write_cell(ws_sum, ri, 1, row["item_identifier"])
        _write_cell(ws_sum, ri, 2, ov, _sfill(ov))
        _write_cell(ws_sum, ri, 3, row["interactions"])
        _write_cell(ws_sum, ri, 4, row["total_tests"])
        _write_cell(ws_sum, ri, 5, row["passed"],  _P_FILL if row["passed"]  > 0 else None)
        _write_cell(ws_sum, ri, 6, row["failed"],  _F_FILL if row["failed"]  > 0 else None)
        _write_cell(ws_sum, ri, 7, row["errors"],  _E_FILL if row["errors"]  > 0 else None)
        _write_cell(ws_sum, ri, 8, row["notes"])
        ws_sum.row_dimensions[ri].height = 18

    # ------------------------------------------------------------------
    # Sheet 2 — All Tests
    # ------------------------------------------------------------------
    ws_all = wb.create_sheet("All Tests")
    ws_all.freeze_panes = "A3"

    ws_all.merge_cells("A1:J1")
    ws_all["A1"].value     = "Per-test detail — every choice / subset / text value submitted"
    ws_all["A1"].font      = Font(name="Arial", bold=True, size=11, color="2E4057")
    ws_all["A1"].alignment = _LEFT
    ws_all.row_dimensions[1].height = 22

    _write_header(ws_all, 2, [
        ("A", "item_identifier",    22),
        ("B", "interaction_id",     20),
        ("C", "cardinality",        12),
        ("D", "submitted",          42),
        ("E", "expected_is_correct", 16),
        ("F", "actual_is_correct",  16),
        ("G", "expected_score",     14),
        ("H", "actual_score",       12),
        ("I", "status",             10),
        ("J", "detail",             60),
    ])

    for ri, row in enumerate(detail_rows, start=3):
        st = row["status"]
        _write_cell(ws_all, ri, 1,  row["item_identifier"])
        _write_cell(ws_all, ri, 2,  row["interaction_id"])
        _write_cell(ws_all, ri, 3,  row["cardinality"])
        _write_cell(ws_all, ri, 4,  str(row["submitted"]))
        _write_cell(ws_all, ri, 5,  str(row["expected_is_correct"]))
        _write_cell(ws_all, ri, 6,  row["actual_is_correct"])
        _write_cell(ws_all, ri, 7,  row["expected_score"])
        _write_cell(ws_all, ri, 8,  row["actual_score"])
        _write_cell(ws_all, ri, 9,  st, _sfill(st))
        _write_cell(ws_all, ri, 10, row["detail"])
        ws_all.row_dimensions[ri].height = 18

    # ------------------------------------------------------------------
    # Sheet 3 — Issues Only
    # ------------------------------------------------------------------
    ws_iss = wb.create_sheet("Issues")
    ws_iss.freeze_panes = "A3"

    ws_iss.merge_cells("A1:J1")
    ws_iss["A1"].value     = "FAILs and ERRORs only"
    ws_iss["A1"].font      = Font(name="Arial", bold=True, size=11, color="2E4057")
    ws_iss["A1"].alignment = _LEFT
    ws_iss.row_dimensions[1].height = 22

    _write_header(ws_iss, 2, [
        ("A", "item_identifier",    22),
        ("B", "interaction_id",     20),
        ("C", "cardinality",        12),
        ("D", "submitted",          42),
        ("E", "expected_is_correct", 16),
        ("F", "actual_is_correct",  16),
        ("G", "expected_score",     14),
        ("H", "actual_score",       12),
        ("I", "status",             10),
        ("J", "detail",             60),
    ])

    issue_rows = [r for r in detail_rows if r["status"] in ("FAIL", "ERROR")]
    if issue_rows:
        for ri, row in enumerate(issue_rows, start=3):
            st = row["status"]
            _write_cell(ws_iss, ri, 1,  row["item_identifier"])
            _write_cell(ws_iss, ri, 2,  row["interaction_id"])
            _write_cell(ws_iss, ri, 3,  row["cardinality"])
            _write_cell(ws_iss, ri, 4,  str(row["submitted"]))
            _write_cell(ws_iss, ri, 5,  str(row["expected_is_correct"]))
            _write_cell(ws_iss, ri, 6,  row["actual_is_correct"])
            _write_cell(ws_iss, ri, 7,  row["expected_score"])
            _write_cell(ws_iss, ri, 8,  row["actual_score"])
            _write_cell(ws_iss, ri, 9,  st, _sfill(st))
            _write_cell(ws_iss, ri, 10, row["detail"])
            ws_iss.row_dimensions[ri].height = 18
    else:
        ws_iss["A3"].value = "🎉 No issues — all tests passed!"
        ws_iss["A3"].font  = Font(name="Arial", size=11, bold=True, color="2E7D32")

    wb.save(report)
    return report, pass_c, fail_c, error_c


# ================================================================
# Template
# ================================================================

def make_template():
    wb = Workbook()
    ws = wb.active
    ws.title = "Items"
    ws.freeze_panes = "A4"

    ws.merge_cells("A1:B1")
    ws["A1"].value     = "QTI Smart Tester — Input Template"
    ws["A1"].font      = Font(name="Arial", bold=True, size=13, color="2E4057")
    ws["A1"].alignment = _LEFT
    ws.row_dimensions[1].height = 28

    ws.merge_cells("A2:B2")
    ws["A2"].value = (
        "Enter one item_identifier per row (column A). "
        "Column B is optional notes. Delete example rows before uploading."
    )
    ws["A2"].font      = Font(name="Arial", size=9, italic=True, color="555555")
    ws["A2"].fill      = _INFO_FILL
    ws["A2"].alignment = _LEFT
    ws.row_dimensions[2].height = 36

    for col, label, width in [("A", "item_identifier", 36), ("B", "notes", 40)]:
        c = ws[f"{col}3"]
        c.value, c.font, c.fill = label, _HDR_FONT, _HDR_FILL
        c.alignment, c.border = _CENTER, _BORDER
        ws.column_dimensions[col].width = width
    ws.row_dimensions[3].height = 22

    for r, (a, b) in enumerate([
        ("EXAMPLE_ITEM_001", "delete or overwrite"),
        ("EXAMPLE_ITEM_002", "delete or overwrite"),
    ], start=8):
        for ci, v in enumerate([a, b], start=1):
            cell = ws.cell(row=r, column=ci, value=v)
            cell.font, cell.fill = _EX_FONT, _EX_FILL
            cell.alignment, cell.border = _LEFT, _BORDER
        ws.row_dimensions[r].height = 18

    wb.save(TEMPLATE_PATH)


# ================================================================
# Template reading
# ================================================================

def read_uploaded_template(file_bytes: bytes) -> list:
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb["Items"]
    items = []
    for row in ws.iter_rows(min_row=4, values_only=True):
        item_id, notes = (list(row) + [None, None])[:2]
        if not item_id or str(item_id).strip() == "":
            continue
        item_id   = str(item_id).strip()
        notes_str = str(notes or "").strip()
        if item_id.startswith("EXAMPLE_") or notes_str.lower().startswith("delete"):
            continue
        items.append({"item_id": item_id, "notes": notes_str})
    return items


# ================================================================
# Widgets
# ================================================================

_title = widgets.HTML(
    "<h2 style='color:#2E4057;margin-bottom:4px'>QTI Smart Tester</h2>"
    "<p style='color:#555;margin-top:0;font-size:13px'>"
    "Tests every choice / subset / correct-text variant against the live platform.</p>"
)

_token_input = widgets.Password(
    description="Token:",
    placeholder="Paste Bearer token",
    layout=widgets.Layout(width="700px"),
    style={"description_width": "90px"},
)

_validate_btn = widgets.Button(
    description="Validate Token",
    button_style="primary",
    icon="check",
    layout=widgets.Layout(margin="0 8px 0 0"),
)
_template_btn = widgets.Button(
    description="Download Template",
    icon="download",
    layout=widgets.Layout(margin="0 8px 0 0"),
)
_run_btn = widgets.Button(
    description="Upload Template & Run",
    button_style="success",
    icon="play",
)

_progress_bar   = widgets.IntProgress(
    min=0, max=1, value=0,
    description="",
    layout=widgets.Layout(width="580px"),
    style={"bar_color": "#2E4057"},
)
_progress_label = widgets.Label("")
_status_out     = widgets.Output()


# ================================================================
# Button handlers
# ================================================================

def _on_validate(b):
    with _status_out:
        clear_output()
        token = _token_input.value.strip()
        if not token:
            print("⚠️  Please paste a token first.")
            return
        try:
            r = requests.get(
                BASE_URL.rstrip("/") + "/api/assessment-items",
                headers=_auth_headers(token),
                timeout=10,
            )
            if r.status_code == 401:
                print("❌  Token invalid (401 Unauthorised).")
            else:
                print(f"✅  Token accepted — HTTP {r.status_code}")
        except Exception as exc:
            print(f"⚠️  Could not reach the server: {exc}")


def _on_template(b):
    with _status_out:
        clear_output()
        make_template()
        print("✅  Template created. Fill column A with item identifiers, then use 'Upload Template & Run'.")
    files.download(TEMPLATE_PATH)


def _on_run(b):
    with _status_out:
        clear_output()

    token = _token_input.value.strip()
    if not token:
        with _status_out:
            print("⚠️  Please validate your token first.")
        return

    with _status_out:
        print("⬆️  Choose your filled template file…")

    uploaded = files.upload()
    if not uploaded:
        with _status_out:
            clear_output()
            print("❌  No file uploaded.")
        return

    file_bytes = list(uploaded.values())[0]
    try:
        item_list = read_uploaded_template(file_bytes)
    except Exception as exc:
        with _status_out:
            clear_output()
            print(f"❌  Failed to read template: {exc}")
        return

    if not item_list:
        with _status_out:
            clear_output()
            print("❌  No items found. Make sure identifiers are in column A and example rows are deleted.")
        return

    headers        = _auth_headers(token)
    summary_rows   = []
    detail_rows    = []
    total_items    = len(item_list)

    _progress_bar.max   = total_items
    _progress_bar.value = 0
    _progress_label.value = f"0 / {total_items} items"

    with _status_out:
        clear_output()
        print(f"✅  Loaded {total_items} item(s).")
        print("⏳  Running smart tests…")

    for idx, entry in enumerate(item_list, 1):
        iid   = entry["item_id"]
        notes = entry["notes"]

        sum_row = {
            "item_identifier": iid,
            "overall":         "❌ ERROR",
            "interactions":    0,
            "total_tests":     0,
            "passed":          0,
            "failed":          0,
            "errors":          0,
            "notes":           notes,
        }

        def _abort(msg: str):
            sum_row["errors"] = 1
            detail_rows.append({
                "item_identifier":     iid,
                "interaction_id":      "-",
                "cardinality":         "-",
                "submitted":           "-",
                "expected_is_correct": "-",
                "actual_is_correct":   "-",
                "expected_score":      "-",
                "actual_score":        "-",
                "status":              "ERROR",
                "detail":              msg,
            })
            summary_rows.append(sum_row)

        # --- fetch ---
        jbody, err = fetch_item(iid, headers)
        if err:
            _abort(f"Fetch failed: {err}")
            _progress_bar.value  = idx
            _progress_label.value = f"{idx} / {total_items} items"
            continue

        raw_xml = jbody.get("rawXml") or jbody.get("rawxml") or ""
        if not raw_xml:
            _abort("No rawXml field in API response")
            _progress_bar.value  = idx
            _progress_label.value = f"{idx} / {total_items} items"
            continue

        # --- parse ---
        decls, score_max, err = parse_item_info(raw_xml)
        if err:
            _abort(f"Parse error: {err}")
            _progress_bar.value  = idx
            _progress_label.value = f"{idx} / {total_items} items"
            continue

        # --- generate test cases ---
        test_cases = (
            generate_test_cases(decls, score_max)
            + generate_combination_tests(decls, score_max)
        )
        sum_row["interactions"] = len(decls)
        sum_row["total_tests"]  = len(test_cases)

        # --- run each test case ---
        for case in test_cases:
            # combination tests carry the full payload dict directly
            if case.get("full_payload"):
                payload = case["payload_value"]
            else:
                payload = {case["interaction_id"]: case["payload_value"]}
            sc, body, err = call_process(iid, payload, headers)

            if err:
                status, actual_ic, actual_sc, detail = "ERROR", "-", "-", err
            else:
                status, actual_ic, actual_sc, detail = evaluate_case(sc, body, case)

            detail_rows.append({
                "item_identifier":     iid,
                "interaction_id":      case["interaction_id"],
                "cardinality":         case["cardinality"],
                "submitted":           str(case["payload_value"]),
                "expected_is_correct": str(case["expected_is_correct"]),
                "actual_is_correct":   actual_ic,
                "expected_score":      case["expected_score"],
                "actual_score":        actual_sc,
                "status":              status,
                "detail":              detail,
            })

            if   status == "PASS":  sum_row["passed"]  += 1
            elif status == "FAIL":  sum_row["failed"]   += 1
            else:                   sum_row["errors"]   += 1

            time.sleep(API_DELAY)

        # --- item overall ---
        if   sum_row["errors"] > 0: sum_row["overall"] = "❌ ERROR"
        elif sum_row["failed"] > 0: sum_row["overall"] = "⚠️ FAIL"
        else:                        sum_row["overall"] = "✅ PASS"

        summary_rows.append(sum_row)
        _progress_bar.value   = idx
        _progress_label.value = f"{idx} / {total_items} items"

    # --- build and download report ---
    report, pass_c, fail_c, error_c = build_results_excel(summary_rows, detail_rows)

    with _status_out:
        clear_output()
        print(f"✅  Done.  Items: {total_items}  |  "
              f"✅ {pass_c} passed  ⚠️ {fail_c} failed  ❌ {error_c} errors")
        print(f"📥  Downloading: {report}")

    files.download(report)


# ================================================================
# Wire up & display
# ================================================================

_validate_btn.on_click(_on_validate)
_template_btn.on_click(_on_template)
_run_btn.on_click(_on_run)

display(widgets.VBox([
    _title,
    _token_input,
    widgets.HBox([_validate_btn, _template_btn, _run_btn]),
    _status_out,
    widgets.HBox([_progress_bar, _progress_label]),
]))
