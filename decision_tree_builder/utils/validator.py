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

    graph = build_graph(flow_data)

    if graph.number_of_nodes() == 0:
        errors.append("El flujo no contiene nodos.")
        return {"valid": False, "errors": errors, "warnings": warnings, "paths": []}

    start_nodes = roots(graph)
    if not start_nodes:
        errors.append("No se encontraron nodos raíz (sin entradas).")

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
            expected = node.get("expected_answers")
            if expected:
                expected_set = {str(value).strip() for value in expected if value is not None}
                for edge in outgoing:
                    label = (edge.get("label") or "").strip()
                    if label and label not in expected_set:
                        errors.append(
                            f"La etiqueta '{label}' desde '{node_id}' no coincide con expected_answers."
                        )
                missing_labels = expected_set.difference(
                    {(edge.get("label") or "").strip() for edge in outgoing}
                )
                if missing_labels:
                    warnings.append(
                        f"La pregunta '{node_id}' tiene respuestas esperadas sin conexión: {', '.join(sorted(missing_labels))}."
                    )

    all_paths = enumerate_paths(flow_data) if not errors else []

    return {"valid": not errors, "errors": errors, "warnings": warnings, "paths": all_paths}


__all__ = ["validate_flow"]
