"""
QTI XML Parser — supports QTI 2.1, 2.2, and 3.0 assessment items.
Extracts structure needed for AI-powered review.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path


# QTI namespace URIs (mapped to short prefix for internal use)
# QTI 3.0 is listed first — it is the primary supported version.
QTI_NAMESPACES = {
    "http://www.imsglobal.org/xsd/imsqtiasi_v3p0": "qti30",
    "http://www.imsglobal.org/xsd/imsqti_v2p2": "qti22",
    "http://www.imsglobal.org/xsd/imsqti_v2p1": "qti21",
}

# Known responseProcessing templates
RP_TEMPLATES = {
    "http://www.imsglobal.org/question/qti/v2p1/rptemplates/match_correct": "match_correct",
    "http://www.imsglobal.org/question/qti/v2p1/rptemplates/map_response": "map_response",
    "http://www.imsglobal.org/question/qti/v2p1/rptemplates/map_response_point": "map_response_point",
    "http://www.imsglobal.org/question/qti/v2p2/rptemplates/match_correct": "match_correct",
    "http://www.imsglobal.org/question/qti/v2p2/rptemplates/map_response": "map_response",
}

# Interaction element names (QTI interaction types)
INTERACTION_TYPES = {
    "choiceInteraction",
    "textEntryInteraction",
    "extendedTextInteraction",
    "matchInteraction",
    "orderInteraction",
    "associateInteraction",
    "gapMatchInteraction",
    "inlineChoiceInteraction",
    "hotspotInteraction",
    "selectPointInteraction",
    "graphicGapMatchInteraction",
    "sliderInteraction",
    "uploadInteraction",
    "drawingInteraction",
    "customInteraction",
    "hottextInteraction",
    "mediaInteraction",
    "positionObjectInteraction",
}


@dataclass
class SimpleChoice:
    identifier: str
    content: str
    fixed: bool = False


@dataclass
class ResponseDeclaration:
    identifier: str
    cardinality: str        # single | multiple | ordered | record
    base_type: str          # identifier | string | integer | float | boolean | ...
    correct_response: list[str] = field(default_factory=list)
    # mapping: identifier -> score
    mapping: dict[str, float] = field(default_factory=dict)
    default_value: Optional[float] = None


@dataclass
class OutcomeDeclaration:
    identifier: str
    cardinality: str
    base_type: str
    default_value: Optional[float] = None
    normal_maximum: Optional[float] = None
    normal_minimum: Optional[float] = None


@dataclass
class Interaction:
    interaction_type: str       # e.g. choiceInteraction
    response_identifier: str
    prompt: str = ""
    choices: list[SimpleChoice] = field(default_factory=list)
    max_choices: int = 1
    min_choices: int = 0
    shuffle: bool = False
    # Extra attributes (e.g. expectedLength for extendedText)
    extra: dict = field(default_factory=dict)


@dataclass
class QTIItem:
    """Parsed representation of a QTI assessmentItem."""
    file_path: str
    identifier: str
    title: str
    qti_version: str            # qti21 | qti22 | qti30 | unknown
    adaptive: bool = False
    time_dependent: bool = False
    language: Optional[str] = None

    response_declarations: list[ResponseDeclaration] = field(default_factory=list)
    outcome_declarations: list[OutcomeDeclaration] = field(default_factory=list)
    interactions: list[Interaction] = field(default_factory=list)

    item_body_text: str = ""    # plain-text rendering of itemBody

    # responseProcessing
    rp_template: Optional[str] = None      # short template name if template= attr used
    rp_custom_xml: Optional[str] = None    # raw XML if custom logic

    # Any rubricBlock / stylesheet / modal feedback content
    rubric_text: str = ""
    feedback_identifiers: list[str] = field(default_factory=list)

    parse_errors: list[str] = field(default_factory=list)
    raw_xml: str = ""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _strip_ns(tag: str) -> str:
    """'{uri}localname' → 'localname'"""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _detect_version(root: ET.Element) -> str:
    tag = root.tag
    for uri, short in QTI_NAMESPACES.items():
        if uri in tag:
            return short
    return "unknown"


def _ns_uri(root: ET.Element) -> Optional[str]:
    """Extract namespace URI from root tag."""
    if root.tag.startswith("{"):
        return root.tag.split("}", 1)[0][1:]
    return None


def _find_all_local(element: ET.Element, local_name: str) -> list[ET.Element]:
    """Find all descendants whose local tag name matches (ignoring namespace)."""
    return [el for el in element.iter() if _strip_ns(el.tag) == local_name]


def _text_content(element: Optional[ET.Element]) -> str:
    """Recursively extract all text from an element."""
    if element is None:
        return ""
    parts = []
    if element.text:
        parts.append(element.text.strip())
    for child in element:
        parts.append(_text_content(child))
        if child.tail:
            parts.append(child.tail.strip())
    return " ".join(p for p in parts if p)


def _parse_response_declaration(el: ET.Element) -> ResponseDeclaration:
    rd = ResponseDeclaration(
        identifier=el.get("identifier", ""),
        cardinality=el.get("cardinality", "single"),
        base_type=el.get("baseType", "identifier"),
    )

    # correctResponse
    for cr in _find_all_local(el, "correctResponse"):
        for val in _find_all_local(cr, "value"):
            if val.text:
                rd.correct_response.append(val.text.strip())

    # mapping
    for mapping_el in _find_all_local(el, "mapping"):
        rd.default_value = _safe_float(mapping_el.get("defaultValue"))
        for entry in _find_all_local(mapping_el, "mapEntry"):
            key = entry.get("mapKey", "")
            val = _safe_float(entry.get("mappedValue", "0"))
            if key:
                rd.mapping[key] = val

    return rd


def _parse_outcome_declaration(el: ET.Element) -> OutcomeDeclaration:
    od = OutcomeDeclaration(
        identifier=el.get("identifier", ""),
        cardinality=el.get("cardinality", "single"),
        base_type=el.get("baseType", "float"),
        normal_maximum=_safe_float(el.get("normalMaximum")),
        normal_minimum=_safe_float(el.get("normalMinimum")),
    )
    for dv in _find_all_local(el, "defaultValue"):
        for v in _find_all_local(dv, "value"):
            od.default_value = _safe_float(v.text)
    return od


def _parse_interaction(el: ET.Element) -> Interaction:
    itype = _strip_ns(el.tag)
    interaction = Interaction(
        interaction_type=itype,
        response_identifier=el.get("responseIdentifier", ""),
        shuffle=el.get("shuffle", "false").lower() == "true",
        max_choices=_safe_int(el.get("maxChoices", "1"), 1),
        min_choices=_safe_int(el.get("minChoices", "0"), 0),
    )

    # prompt
    for prompt_el in _find_all_local(el, "prompt"):
        interaction.prompt = _text_content(prompt_el)
        break

    # choices (choiceInteraction, inlineChoiceInteraction)
    for choice_el in _find_all_local(el, "simpleChoice"):
        interaction.choices.append(SimpleChoice(
            identifier=choice_el.get("identifier", ""),
            content=_text_content(choice_el),
            fixed=choice_el.get("fixed", "false").lower() == "true",
        ))

    # inlineChoice elements
    for choice_el in _find_all_local(el, "inlineChoice"):
        interaction.choices.append(SimpleChoice(
            identifier=choice_el.get("identifier", ""),
            content=_text_content(choice_el),
        ))

    # Extra useful attributes
    for attr in ("expectedLength", "expectedLines", "format", "patternMask", "placeholderText"):
        val = el.get(attr)
        if val is not None:
            interaction.extra[attr] = val

    return interaction


def _parse_response_processing(el: ET.Element) -> tuple[Optional[str], Optional[str]]:
    """Returns (template_short_name, custom_xml_string)."""
    template_uri = el.get("template")
    if template_uri:
        short = RP_TEMPLATES.get(template_uri, template_uri.split("/")[-1])
        return short, None
    # Custom logic — store raw XML
    custom_xml = ET.tostring(el, encoding="unicode")
    return None, custom_xml


def _safe_float(val: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_int(val: Optional[str], default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_qti_file(file_path: str) -> QTIItem:
    """Parse a QTI XML file and return a QTIItem."""
    path = Path(file_path)
    raw_xml = path.read_text(encoding="utf-8", errors="replace")

    item = QTIItem(
        file_path=str(path),
        identifier="",
        title="",
        qti_version="unknown",
        raw_xml=raw_xml,
    )

    try:
        root = ET.fromstring(raw_xml)
    except ET.ParseError as e:
        item.parse_errors.append(f"XML parse error: {e}")
        return item

    local_root = _strip_ns(root.tag)
    if local_root != "assessmentItem":
        item.parse_errors.append(
            f"Root element is '{local_root}', expected 'assessmentItem'"
        )
        # Still try to continue

    item.qti_version = _detect_version(root)
    item.identifier = root.get("identifier", "")
    item.title = root.get("title", "")
    item.adaptive = root.get("adaptive", "false").lower() == "true"
    item.time_dependent = root.get("timeDependent", "false").lower() == "true"
    item.language = root.get("{http://www.w3.org/XML/1998/namespace}lang") or root.get("lang")

    # responseDeclaration
    for el in _find_all_local(root, "responseDeclaration"):
        item.response_declarations.append(_parse_response_declaration(el))

    # outcomeDeclaration
    for el in _find_all_local(root, "outcomeDeclaration"):
        item.outcome_declarations.append(_parse_outcome_declaration(el))

    # itemBody — extract text and interactions
    for body_el in _find_all_local(root, "itemBody"):
        # Collect all text outside interactions first
        item.item_body_text = _extract_body_text(body_el)
        # Parse interactions
        for child in body_el.iter():
            if _strip_ns(child.tag) in INTERACTION_TYPES:
                item.interactions.append(_parse_interaction(child))

    # responseProcessing
    for rp_el in _find_all_local(root, "responseProcessing"):
        item.rp_template, item.rp_custom_xml = _parse_response_processing(rp_el)
        break

    # rubricBlock
    for rb_el in _find_all_local(root, "rubricBlock"):
        item.rubric_text += _text_content(rb_el) + "\n"

    # modalFeedback identifiers
    for fb_el in _find_all_local(root, "modalFeedback"):
        ident = fb_el.get("identifier", "")
        if ident:
            item.feedback_identifiers.append(ident)

    return item


def _extract_body_text(body_el: ET.Element) -> str:
    """Extract readable text from itemBody, excluding interaction sub-trees."""
    parts = []

    def _walk(el: ET.Element, in_interaction: bool = False):
        local = _strip_ns(el.tag)
        is_interaction = local in INTERACTION_TYPES

        if is_interaction:
            # Collect prompt text within interactions
            for child in el:
                if _strip_ns(child.tag) == "prompt":
                    parts.append("[Prompt] " + _text_content(child))
            return  # Don't recurse into interaction body (choices handled separately)

        if el.text and el.text.strip():
            parts.append(el.text.strip())

        for child in el:
            _walk(child, in_interaction or is_interaction)
            if child.tail and child.tail.strip():
                parts.append(child.tail.strip())

    _walk(body_el)
    return " ".join(p for p in parts if p)


def summarize_item(item: QTIItem) -> dict:
    """Return a dict summary suitable for passing to the Claude reviewer."""
    interactions_summary = []
    for ix in item.interactions:
        isumm = {
            "type": ix.interaction_type,
            "response_identifier": ix.response_identifier,
            "prompt": ix.prompt,
            "shuffle": ix.shuffle,
            "max_choices": ix.max_choices,
            "min_choices": ix.min_choices,
        }
        if ix.choices:
            isumm["choices"] = [
                {"id": c.identifier, "text": c.content, "fixed": c.fixed}
                for c in ix.choices
            ]
        if ix.extra:
            isumm["extra_attributes"] = ix.extra
        interactions_summary.append(isumm)

    response_decls = []
    for rd in item.response_declarations:
        rdsum = {
            "identifier": rd.identifier,
            "cardinality": rd.cardinality,
            "base_type": rd.base_type,
            "correct_response": rd.correct_response,
        }
        if rd.mapping:
            rdsum["mapping"] = rd.mapping
            rdsum["mapping_default"] = rd.default_value
        response_decls.append(rdsum)

    outcome_decls = []
    for od in item.outcome_declarations:
        odsum = {
            "identifier": od.identifier,
            "cardinality": od.cardinality,
            "base_type": od.base_type,
            "default_value": od.default_value,
            "normal_maximum": od.normal_maximum,
            "normal_minimum": od.normal_minimum,
        }
        outcome_decls.append(odsum)

    return {
        "identifier": item.identifier,
        "title": item.title,
        "qti_version": item.qti_version,
        "adaptive": item.adaptive,
        "time_dependent": item.time_dependent,
        "language": item.language,
        "item_body_text": item.item_body_text,
        "interactions": interactions_summary,
        "response_declarations": response_decls,
        "outcome_declarations": outcome_decls,
        "response_processing_template": item.rp_template,
        "response_processing_custom": item.rp_custom_xml,
        "rubric_text": item.rubric_text,
        "feedback_identifiers": item.feedback_identifiers,
        "parse_errors": item.parse_errors,
    }
