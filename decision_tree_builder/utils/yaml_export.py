"""Utilities to transform flow definitions into YAML files."""

from __future__ import annotations

import re
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

import yaml

from .paths import FlowDict

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
START_NODE_TITLE = "Start"


def _serialize_metadata(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        return {"text": value}
    return {}


def _normalise_expected_answers(value) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    if not isinstance(value, list):
        return results
    for item in value:
        if isinstance(item, dict):
            if any(key in item for key in ("value", "label", "answer")):
                raw_value = item.get("value") or item.get("label") or item.get("answer")
                if raw_value is None:
                    continue
                value_text = str(raw_value).strip()
                if not value_text:
                    continue
                description_raw = item.get("description") or item.get("text") or item.get("explanation") or ""
                description_text = str(description_raw).strip() if description_raw else ""
                entry: Dict[str, str] = {"value": value_text}
                if description_text:
                    entry["description"] = description_text
                results.append(entry)
                continue
            if len(item) == 1:
                key, val = next(iter(item.items()))
                value_text = str(key).strip()
                if not value_text:
                    continue
                description_text = "" if val is None else str(val).strip()
                entry = {"value": value_text}
                if description_text:
                    entry["description"] = description_text
                results.append(entry)
                continue
        elif item is not None:
            value_text = str(item).strip()
            if value_text:
                results.append({"value": value_text})
    return results


def _normalise_title(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _humanise_identifier(identifier: Any) -> str:
    text = _normalise_title(identifier)
    if not text:
        return ""
    parts = [part for part in re.split(r"[_\-]+", text) if part]
    if not parts:
        return text.title()
    return " ".join(part[:1].upper() + part[1:] for part in parts)


def _derive_node_title(node: Dict) -> str:
    if not isinstance(node, dict):
        return "Nodo"
    for key in ("title", "name"):
        candidate = _normalise_title(node.get(key))
        if candidate:
            return candidate
    metadata = node.get("metadata")
    if isinstance(metadata, dict):
        candidate = _normalise_title(metadata.get("title"))
        if candidate:
            return candidate
    identifier = node.get("id")
    fallback = _humanise_identifier(identifier)
    if fallback:
        return fallback
    node_type = _normalise_title(node.get("type"))
    return node_type.capitalize() if node_type else "Nodo"


def _assign_unique_title(title: str, used: Set[str]) -> str:
    base = title.strip() if title else "Nodo"
    candidate = base
    counter = 2
    while candidate in used:
        candidate = f"{base} ({counter})"
        counter += 1
    used.add(candidate)
    return candidate


def _prepare_question(node: Dict, outgoing: List[Dict], title_lookup: Dict[str, str]) -> Dict:
    data: Dict[str, object] = {
        "type": "question",
        "question": node.get("question", ""),
    }
    expected_entries = _normalise_expected_answers(node.get("expected_answers"))
    if expected_entries:
        serialised: List[object] = []
        for entry in expected_entries:
            value_text = entry.get("value", "")
            if not value_text:
                continue
            description_text = entry.get("description", "").strip()
            if description_text:
                serialised.append(OrderedDict([(value_text, description_text)]))
            else:
                serialised.append(value_text)
        if serialised:
            data["expected_answers"] = serialised

    if outgoing:
        next_map: Dict[str, str] = OrderedDict()
        for edge in outgoing:
            label = edge.get("label") or f"next_{edge.get('target') or 'desconocido'}"
            if label in next_map:
                suffix = 2
                while f"{label}_{suffix}" in next_map:
                    suffix += 1
                label = f"{label}_{suffix}"
            target_raw = edge.get("target")
            target_key = str(target_raw) if target_raw is not None else ""
            fallback_target = str(target_raw) if target_raw else "desconocido"
            target_title = title_lookup.get(target_key, fallback_target)
            next_map[label] = target_title
        data["next"] = next_map

    metadata = _serialize_metadata(node.get("metadata"))
    if metadata:
        data["metadata"] = metadata
    return data


def _prepare_message(node: Dict) -> Dict:
    data: Dict[str, object] = {
        "type": "message",
        "message": node.get("message", ""),
    }
    if node.get("severity"):
        data["severity"] = node.get("severity")
    metadata = _serialize_metadata(node.get("metadata"))
    if metadata:
        data["metadata"] = metadata
    return data


def _serialise_node(node: Dict, outgoing: List[Dict], title_lookup: Dict[str, str]) -> Dict:
    node_type = node.get("type")
    if node_type == "question":
        return _prepare_question(node, outgoing, title_lookup)
    if node_type == "message":
        return _prepare_message(node)
    data = {key: value for key, value in node.items() if key not in {"position", "type"}}
    data["type"] = node_type or "custom"
    return data


def flow_to_structure(flow_data: FlowDict) -> Tuple[Dict[str, object], Dict[str, Dict]]:
    nodes = flow_data.get("nodes", []) if isinstance(flow_data, dict) else []
    edges = flow_data.get("edges", []) if isinstance(flow_data, dict) else []

    edges_by_source: Dict[str, List[Dict]] = {}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source = edge.get("source")
        if source is None:
            continue
        source_key = str(source)
        edges_by_source.setdefault(source_key, []).append(edge)

    used_titles: Set[str] = {START_NODE_TITLE}
    title_lookup: Dict[str, str] = {}
    prepared_nodes: List[Tuple[Dict, str]] = []
    start_node = None
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        if node_id is None:
            continue
        node_key = str(node_id)
        if node.get("type") == "start":
            start_node = node
            title_lookup[node_key] = START_NODE_TITLE
            continue
        desired_title = _derive_node_title(node)
        unique_title = _assign_unique_title(desired_title, used_titles)
        title_lookup[node_key] = unique_title
        prepared_nodes.append((node, unique_title))

    order_priority = {"question": 0, "message": 1}
    ordered_nodes = sorted(
        prepared_nodes,
        key=lambda item: (order_priority.get(item[0].get("type"), 99), item[1].lower()),
    )

    tree: "OrderedDict[str, Dict]" = OrderedDict()
    if start_node:
        start_key = str(start_node.get("id"))
        outgoing = edges_by_source.get(start_key, []) or []
        first_edge = outgoing[0] if outgoing else None
        target_value = ""
        if first_edge:
            target_raw = first_edge.get("target")
            if target_raw is not None:
                target_value = str(target_raw)
        tree[START_NODE_TITLE] = target_value

    for node, display_title in ordered_nodes:
        node_key = str(node.get("id"))
        tree[display_title] = _serialise_node(node, edges_by_source.get(node_key, []), title_lookup)

    header: "OrderedDict[str, object]" = OrderedDict()
    header["flow"] = tree

    metadata: "OrderedDict[str, object]" = OrderedDict()
    if flow_data.get("id"):
        metadata["id"] = flow_data.get("id")
    if flow_data.get("name"):
        metadata["name"] = flow_data.get("name")
    if flow_data.get("description"):
        metadata["description"] = flow_data.get("description")
    if metadata:
        header["metadata"] = metadata
    return header, tree


_BOOLEAN_LITERALS = {"y", "yes", "n", "no", "true", "false", "on", "off", "null", "none"}


def _should_quote(text: str) -> bool:
    """Return True if the YAML scalar should be wrapped in quotes."""

    if not text:
        return False

    stripped = text.strip()

    if stripped.lower() in _BOOLEAN_LITERALS:
        return True

    if stripped != text:
        return True

    if any(ord(char) > 127 for char in text):
        return True

    if any(char in text for char in {"¿", "¡", "?", "!", '"', "'"}):
        return True

    if any(char.isspace() for char in text):
        return True

    return False


class FlowYAMLDumper(yaml.SafeDumper):
    """Custom dumper to force quoting rules compatible with external tools."""


def _represent_str(dumper: FlowYAMLDumper, data: str):
    style = '"' if _should_quote(data) else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


FlowYAMLDumper.add_representer(str, _represent_str)


def _to_builtin(value: Any) -> Any:
    """Return a structure containing only built-in serialisable types."""

    if isinstance(value, OrderedDict):
        value = dict(value.items())

    if isinstance(value, dict):
        return {key: _to_builtin(val) for key, val in value.items()}

    if isinstance(value, list):
        return [_to_builtin(item) for item in value]

    if isinstance(value, tuple):
        return [_to_builtin(item) for item in value]

    return value


def flow_to_yaml(flow_data: FlowDict) -> Tuple[str, Dict[str, object]]:
    structure, _ = flow_to_structure(flow_data)
    plain_structure = _to_builtin(structure)
    yaml_text = yaml.dump(
        plain_structure,
        Dumper=FlowYAMLDumper,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        indent=2,
    )
    return yaml_text, plain_structure


def write_yaml_file(project_id: str, flow_id: str, content: str) -> Path:
    project_dir = DATA_DIR / project_id / "flows"
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / f"{flow_id}.yaml"
    path.write_text(content, encoding="utf-8")
    return path


__all__ = ["flow_to_yaml", "flow_to_structure", "write_yaml_file"]
