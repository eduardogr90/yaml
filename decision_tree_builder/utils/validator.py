"""Flow validation utilities."""

from __future__ import annotations

from typing import Dict, List, Tuple

import networkx as nx

from .paths import build_graph, enumerate_paths, roots, terminals


def _collect_node_ids(nodes: List[Dict]) -> Tuple[List[str], List[str]]:
    """Return node identifiers and the list of nodes without identifiers."""
    ids: List[str] = []
    missing: List[str] = []
    for node in nodes:
        node_id = node.get("id") if isinstance(node, dict) else None
        if not node_id:
            missing.append(str(node))
            continue
        ids.append(node_id)
    return ids, missing


def _extract_expected_labels(expected) -> List[str]:
    labels: List[str] = []
    if not isinstance(expected, list):
        return labels
    for item in expected:
        if isinstance(item, dict):
            if any(key in item for key in ("value", "label", "answer")):
                raw = item.get("value") or item.get("label") or item.get("answer")
                if raw is None:
                    continue
                text = str(raw).strip()
                if text:
                    labels.append(text)
                continue
            if len(item) == 1:
                key, _ = next(iter(item.items()))
                text = str(key).strip()
                if text:
                    labels.append(text)
                continue
        elif item is not None:
            text = str(item).strip()
            if text:
                labels.append(text)
    return labels


def validate_flow(flow_data: Dict) -> Dict[str, object]:
    """Validate the flow structure and return diagnostics."""
    errors: List[str] = []
    warnings: List[str] = []

    nodes = flow_data.get("nodes", []) if isinstance(flow_data, dict) else []
    edges = flow_data.get("edges", []) if isinstance(flow_data, dict) else []

    node_ids, missing_nodes = _collect_node_ids(nodes)
    if missing_nodes:
        errors.append("Hay nodos sin identificador definido.")

    duplicates = {node_id for node_id in node_ids if node_ids.count(node_id) > 1}
    if duplicates:
        errors.append(f"IDs duplicados detectados: {', '.join(sorted(duplicates))}.")

    node_lookup = {node.get("id"): node for node in nodes if node.get("id")}

    edges_by_source: Dict[str, List[Dict]] = {}
    edges_by_target: Dict[str, List[Dict]] = {}
    for edge in edges:
        if not isinstance(edge, dict):
            warnings.append("Se ignoró una arista con formato inválido.")
            continue
        source = edge.get("source")
        target = edge.get("target")
        label = edge.get("label")
        if not source or not target:
            errors.append("Una conexión carece de origen o destino.")
            continue
        if source not in node_lookup:
            errors.append(f"La conexión hace referencia a un nodo inexistente: {source}.")
        if target not in node_lookup:
            errors.append(f"La conexión hace referencia a un nodo inexistente: {target}.")
        if not label:
            warnings.append(f"La conexión {source} → {target} no tiene etiqueta definida.")
        edges_by_source.setdefault(source, []).append(edge)
        edges_by_target.setdefault(target, []).append(edge)

    start_nodes = [node for node in nodes if node.get("type") == "start"]
    start_id = None
    if not start_nodes:
        errors.append("Debe existir un nodo de inicio (Start).")
    else:
        if len(start_nodes) > 1:
            errors.append("Solo puede existir un nodo de inicio (Start).")
        start_node = start_nodes[0]
        start_id = start_node.get("id")
        if not start_id:
            errors.append("El nodo de inicio debe tener un identificador definido.")
        elif str(start_id).lower() != "start":
            errors.append("El identificador del nodo de inicio debe ser 'start'.")
        incoming = edges_by_target.get(start_id or "", [])
        if incoming:
            errors.append("El nodo de inicio no puede tener conexiones entrantes.")
        outgoing = edges_by_source.get(start_id or "", [])
        if len(outgoing or []) > 1:
            errors.append("El nodo de inicio solo puede tener una conexión saliente.")
        if not outgoing:
            warnings.append("El nodo de inicio no tiene conexiones salientes.")

    graph = build_graph(flow_data)

    if graph.number_of_nodes() == 0:
        errors.append("El flujo no contiene nodos.")
        return {"valid": False, "errors": errors, "warnings": warnings, "paths": []}

    start_nodes = roots(graph)
    if not start_nodes:
        errors.append("No se encontraron nodos raíz (sin entradas).")
    elif start_id and any(node != start_id for node in start_nodes):
        remaining = [node for node in start_nodes if node != start_id]
        if remaining:
            errors.append(
                "Todos los nodos raíz deben estar conectados desde Start. Sin entradas: "
                + ", ".join(sorted(remaining))
                + "."
            )

    end_nodes = terminals(graph)
    if not end_nodes:
        errors.append("No se encontraron nodos terminales.")

    try:
        cycle = nx.find_cycle(graph, orientation="original")
    except nx.NetworkXNoCycle:
        cycle = None
    if cycle:
        formatted = " → ".join(edge[0] for edge in cycle + [cycle[0]])
        errors.append(f"Se detectó un ciclo en el flujo: {formatted}.")

    for node in nodes:
        node_id = node.get("id")
        node_type = node.get("type")
        outgoing = edges_by_source.get(node_id, [])
        if node_type == "message" and outgoing:
            errors.append(f"El nodo terminal '{node_id}' no debe tener conexiones salientes.")
        if node_type == "question":
            expected_labels = _extract_expected_labels(node.get("expected_answers"))
            if expected_labels:
                expected_set = {label for label in expected_labels}
                for edge in outgoing:
                    label = (edge.get("label") or "").split(":", 1)[0].strip()
                    if label and label not in expected_set:
                        errors.append(
                            f"La etiqueta '{label}' desde '{node_id}' no coincide con expected_answers."
                        )
                missing_labels = expected_set.difference(
                    {(edge.get("label") or "").split(":", 1)[0].strip() for edge in outgoing}
                )
                if missing_labels:
                    warnings.append(
                        f"La pregunta '{node_id}' tiene respuestas esperadas sin conexión: {', '.join(sorted(missing_labels))}."
                    )

    all_paths = enumerate_paths(flow_data) if not errors else []

    return {"valid": not errors, "errors": errors, "warnings": warnings, "paths": all_paths}


__all__ = ["validate_flow"]
