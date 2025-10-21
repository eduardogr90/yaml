"""Utilities to transform flow definitions into YAML files."""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

FlowDict = Dict[str, Any]


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


def _prepare_action(node: Dict, outgoing: List[Dict]) -> Dict:
    data: Dict[str, object] = {
        "type": "action",
        "action": node.get("action", ""),
    }
    parameters = node.get("parameters")
    if isinstance(parameters, dict):
        data["parameters"] = parameters
    elif isinstance(parameters, str) and parameters.strip():
        data["parameters"] = {"value": parameters.strip()}

    if outgoing:
        if len(outgoing) == 1 and not outgoing[0].get("label"):
            data["next"] = outgoing[0].get("target")
        else:
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
    if node_type == "action":
        return _prepare_action(node, outgoing)
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

    ordered_nodes: List[Dict] = []
    buckets: Dict[str, List[Dict]] = {
        "question": [],
        "action": [],
        "message": [],
        "other": [],
    }

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = (node.get("type") or "").lower()
        if node_type in {"question", "action", "message"}:
            buckets[node_type].append(node)
        else:
            buckets["other"].append(node)

    for node_type in ("question", "action", "message"):
        ordered_nodes.extend(buckets[node_type])
    ordered_nodes.extend(buckets["other"])

    tree: "OrderedDict[str, Dict]" = OrderedDict()
    for node in ordered_nodes:
        node_id = node.get("id")
        if not node_id:
            continue
        tree[node_id] = _serialise_node(node, edges_by_source.get(node_id, []))

    structure: Dict[str, object] = OrderedDict()
    structure["flow"] = tree
    return structure, tree


def flow_to_yaml(flow_data: FlowDict) -> Tuple[str, Dict[str, object]]:
    structure, _ = flow_to_structure(flow_data)
    yaml_text = yaml.dump(
        structure,
        sort_keys=False,
        allow_unicode=True,
        indent=2,
        default_flow_style=False,
    )
    return yaml_text, structure


def write_yaml_file(project_id: str, flow_id: str, content: str) -> Path:
    project_dir = DATA_DIR / project_id / "flows"
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / f"{flow_id}.yaml"
    path.write_text(content, encoding="utf-8")
    return path


__all__ = ["flow_to_yaml", "flow_to_structure", "write_yaml_file"]
