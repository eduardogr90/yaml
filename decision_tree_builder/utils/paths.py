"""Helpers for building graph representations and computing decision paths."""

from __future__ import annotations

from typing import Dict, List

import networkx as nx

FlowDict = Dict[str, object]


def build_graph(flow_data: FlowDict) -> nx.DiGraph:
    """Create a directed graph from the JSON flow description."""
    graph = nx.DiGraph()
    nodes = flow_data.get("nodes", []) if isinstance(flow_data, dict) else []
    edges = flow_data.get("edges", []) if isinstance(flow_data, dict) else []

    for node in nodes:
        node_id = node.get("id") if isinstance(node, dict) else None
        if node_id:
            graph.add_node(node_id, **node)

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source = edge.get("source")
        target = edge.get("target")
        if source and target:
            graph.add_edge(source, target, **edge)

    return graph


def roots(graph: nx.DiGraph) -> List[str]:
    """Return nodes without predecessors."""
    return [node for node, degree in graph.in_degree() if degree == 0]


def terminals(graph: nx.DiGraph) -> List[str]:
    """Return nodes without outgoing edges."""
    return [node for node, degree in graph.out_degree() if degree == 0]


def enumerate_paths(flow_data: FlowDict) -> List[List[str]]:
    """Enumerate all simple paths from roots to terminals."""
    graph = build_graph(flow_data)
    start_nodes = roots(graph)
    end_nodes = terminals(graph)
    paths: List[List[str]] = []

    for start in start_nodes:
        for end in end_nodes:
            if start == end:
                paths.append([start])
                continue
            for path in nx.all_simple_paths(graph, start, end):
                if path not in paths:
                    paths.append(path)
    return paths


__all__ = ["build_graph", "roots", "terminals", "enumerate_paths"]
