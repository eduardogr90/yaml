"""Utilities to transform flow definitions into YAML files."""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

from .paths import FlowDict

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


def _serialize_metadata(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        return {"text": value}
    return {}


def _normalise_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _prepare_question(node: Dict, outgoing: List[Dict]) -> Dict:
    data: Dict[str, object] = {
        "type": "question",
        "question": node.get("question", ""),
    }
    if node.get("check"):
        data["check"] = node.get("check")
    expected = _normalise_list(node.get("expected_answers"))
    if expected:
        data["expected_answers"] = expected

    if outgoing:
        next_map: Dict[str, str] = OrderedDict()
        for edge in outgoing:
            label = edge.get("label") or f"next_{edge.get('target') or 'desconocido'}"
            if label in next_map:
                suffix = 2
                while f"{label}_{suffix}" in next_map:
                    suffix += 1
                label = f"{label}_{suffix}"
            next_map[label] = edge.get("target")
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


def _serialise_node(node: Dict, outgoing: List[Dict]) -> Dict:
    node_type = node.get("type")
    if node_type == "question":
        return _prepare_question(node, outgoing)
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
        if source:
            edges_by_source.setdefault(source, []).append(edge)

    order_priority = {"question": 0, "message": 1}
    ordered_nodes = sorted(
        [node for node in nodes if node.get("id")],
        key=lambda node: (order_priority.get(node.get("type"), 99), node.get("id")),
    )

    tree: "OrderedDict[str, Dict]" = OrderedDict()
    for node in ordered_nodes:
        node_id = node.get("id")
        tree[node_id] = _serialise_node(node, edges_by_source.get(node_id, []))

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
