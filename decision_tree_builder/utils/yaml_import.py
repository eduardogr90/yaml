from __future__ import annotations

from typing import Any, Dict, List, Tuple

import re
import uuid

import yaml

from .paths import FlowDict
from .yaml_export import START_NODE_TITLE


class YamlImportError(ValueError):
    """Error raised when the YAML structure cannot be converted."""


def _normalise_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalise_multiline(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    return text.replace("\r\n", "\n")


def _make_identifier(value: str, used: Dict[str, int]) -> str:
    base = _normalise_text(value).lower()
    base = re.sub(r"[^a-z0-9_-]+", "_", base)
    base = re.sub(r"_+", "_", base).strip("_") or "nodo"
    counter = used.get(base, 0)
    if counter:
        candidate = f"{base}_{counter + 1}"
    else:
        candidate = base
    while candidate in used:
        counter += 1
        candidate = f"{base}_{counter + 1}"
    used[candidate] = counter + 1
    return candidate


def _sanitise_port(label: str) -> str:
    text = _normalise_text(label)
    if not text:
        return "salida"
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug or "salida"


def _parse_expected_answers(entries: Any) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    if not isinstance(entries, list):
        return results
    for item in entries:
        if isinstance(item, dict):
            for key, value in item.items():
                answer = _normalise_text(key)
                if not answer:
                    continue
                description = _normalise_text(value)
                entry: Dict[str, str] = {"value": answer}
                if description:
                    entry["description"] = description
                results.append(entry)
        else:
            answer = _normalise_text(item)
            if answer:
                results.append({"value": answer})
    return results


def _default_position(index: int) -> Dict[str, int]:
    columns = 4
    spacing_x = 320
    spacing_y = 220
    origin_x = 160
    origin_y = 120
    row = index // columns
    col = index % columns
    return {"x": origin_x + col * spacing_x, "y": origin_y + row * spacing_y}


def _generate_edge_id() -> str:
    token = uuid.uuid4().hex
    return f"edge_{token[:8]}_{token[8:16]}"


def _extract_start_target(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("next", "target", "to"):
            candidate = value.get(key)
            text = _normalise_text(candidate)
            if text:
                return text
        raise YamlImportError("El nodo Start debe apuntar a un destino válido.")
    text = _normalise_text(value)
    return text


def yaml_to_flow(yaml_text: str) -> FlowDict:
    if not isinstance(yaml_text, str) or not yaml_text.strip():
        raise YamlImportError("El contenido YAML está vacío.")

    try:
        document = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:  # pragma: no cover - depends on yaml error message
        raise YamlImportError(f"YAML inválido: {exc}") from exc

    if not isinstance(document, dict):
        raise YamlImportError("El YAML debe representar un objeto con la sección 'flow'.")

    flow_section = document.get("flow")
    if not isinstance(flow_section, dict):
        raise YamlImportError("El YAML debe contener una sección 'flow'.")

    metadata_section = document.get("metadata")
    if metadata_section is not None and not isinstance(metadata_section, dict):
        raise YamlImportError("La sección 'metadata' debe ser un objeto.")

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    identifier_usage: Dict[str, int] = {}
    title_lookup: Dict[str, str] = {}
    pending_edges: List[Tuple[str, str, str]] = []
    start_target: str = ""

    node_index = 0
    for raw_title, raw_node in flow_section.items():
        title = _normalise_multiline(raw_title)
        if title.lower() == START_NODE_TITLE.lower():
            start_target = _extract_start_target(raw_node)
            continue

        if not isinstance(raw_node, dict):
            raise YamlImportError(f"El nodo '{title or raw_title}' debe ser un objeto.")

        node_type = _normalise_text(raw_node.get("type")) or "message"
        candidate_id = raw_node.get("id") if isinstance(raw_node.get("id"), str) else title
        node_id = _make_identifier(candidate_id or title, identifier_usage)
        title_lookup[title] = node_id
        title_lookup[title.lower()] = node_id

        node_data: Dict[str, Any] = {
            "id": node_id,
            "type": node_type,
            "position": _default_position(node_index),
        }

        metadata_value = raw_node.get("metadata")
        if isinstance(metadata_value, dict):
            node_data["metadata"] = metadata_value

        appearance_value = raw_node.get("appearance")
        if isinstance(appearance_value, dict):
            node_data["appearance"] = appearance_value

        if node_type == "question":
            node_data["question"] = _normalise_multiline(raw_node.get("question"))
            expected = _parse_expected_answers(raw_node.get("expected_answers"))
            if expected:
                node_data["expected_answers"] = expected
        elif node_type == "message":
            node_data["message"] = _normalise_multiline(raw_node.get("message"))
            severity = raw_node.get("severity")
            if severity is not None:
                node_data["severity"] = _normalise_text(severity)
        else:
            for key, value in raw_node.items():
                if key in {"next", "metadata", "appearance", "id"}:
                    continue
                node_data[key] = value

        next_map = raw_node.get("next")
        if next_map is not None:
            if not isinstance(next_map, dict):
                raise YamlImportError(f"El nodo '{title}' tiene un bloque 'next' inválido.")
            for raw_label, raw_target in next_map.items():
                label = _normalise_text(raw_label)
                target_title = _normalise_text(raw_target)
                if not target_title:
                    raise YamlImportError(f"El nodo '{title}' tiene un destino vacío en 'next'.")
                pending_edges.append((node_id, label, target_title))

        nodes.append(node_data)
        node_index += 1

    if start_target:
        target_id = title_lookup.get(start_target) or title_lookup.get(start_target.lower())
        if not target_id:
            raise YamlImportError(
                f"El nodo Start apunta a '{start_target}', que no existe en el flujo."
            )
        edges.append(
            {
                "id": _generate_edge_id(),
                "source": "start",
                "target": target_id,
                "label": "",
                "source_port": "salida",
                "target_port": "input",
            }
        )

    for source_id, label, target_title in pending_edges:
        target_id = title_lookup.get(target_title) or title_lookup.get(target_title.lower())
        if not target_id:
            raise YamlImportError(
                f"La transición '{label or 'sin etiqueta'}' apunta a '{target_title}', que no existe."
            )
        edges.append(
            {
                "id": _generate_edge_id(),
                "source": source_id,
                "target": target_id,
                "label": label,
                "source_port": _sanitise_port(label),
                "target_port": "input",
            }
        )

    flow_id = _normalise_text(metadata_section.get("id")) if metadata_section else ""
    flow_name = _normalise_multiline(metadata_section.get("name")) if metadata_section else ""
    flow_description = _normalise_multiline(metadata_section.get("description")) if metadata_section else ""

    return {
        "id": flow_id,
        "name": flow_name,
        "description": flow_description,
        "nodes": nodes,
        "edges": edges,
    }


__all__ = ["yaml_to_flow", "YamlImportError"]
