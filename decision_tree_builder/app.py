from __future__ import annotations

import json
import os
import re
import shutil
import stat
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from flask import (
    Flask,
    Response,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)

from utils.validator import validate_flow
from utils.yaml_export import flow_to_yaml, write_yaml_file
from utils.yaml_import import yaml_to_flow, YamlImportError

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
PROJECT_INDEX_FILE = DATA_DIR / "proyectos.json"

app = Flask(__name__)
app.secret_key = "decision-tree-builder"


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


@app.after_request
def disable_caching(response: Response) -> Response:
    """Ensure dynamic content is always fetched from the server."""

    if request.path.startswith("/static/"):
        return response

    mimetype = response.mimetype or ""
    if "text/html" in mimetype or "application/json" in mimetype:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response


# ---------------------------------------------------------------------------
# Utilities for persistence
# ---------------------------------------------------------------------------

def ensure_data_structure() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PROJECT_INDEX_FILE.exists():
        PROJECT_INDEX_FILE.write_text(json.dumps({"projects": []}, indent=2, ensure_ascii=False))


def load_projects() -> List[Dict]:
    ensure_data_structure()
    data = json.loads(PROJECT_INDEX_FILE.read_text(encoding="utf-8"))
    return data.get("projects", [])


def save_projects(projects: List[Dict]) -> None:
    ensure_data_structure()
    PROJECT_INDEX_FILE.write_text(
        json.dumps({"projects": projects}, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def slugify(value: str, prefix: str = "item") -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9_-]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or prefix


def unique_slug(base: str, existing: List[str]) -> str:
    slug = base
    counter = 1
    while slug in existing:
        counter += 1
        slug = f"{base}_{counter}"
    return slug


def get_project_dir(project_id: str) -> Path:
    return DATA_DIR / project_id


def get_flow_dir(project_id: str) -> Path:
    return get_project_dir(project_id) / "flows"


def _handle_remove_readonly(func, path, exc_info):
    """Retry a failed removal after clearing the read-only bit on Windows."""

    exc = exc_info[1]
    if isinstance(exc, PermissionError):
        os.chmod(path, stat.S_IWRITE)
        func(path)
    else:
        raise exc


def load_project_metadata(project_id: str) -> Dict:
    metadata_path = get_project_dir(project_id) / "metadata.json"
    if metadata_path.exists():
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    return {
        "id": project_id,
        "name": project_id,
        "description": "",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }


def save_project_metadata(project_id: str, metadata: Dict) -> None:
    metadata_path = get_project_dir(project_id) / "metadata.json"
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")


def list_flows(project_id: str) -> List[Dict]:
    flow_dir = get_flow_dir(project_id)
    if not flow_dir.exists():
        return []
    flows: Dict[str, Dict] = {}
    for path in sorted(flow_dir.glob("*.json")):
        if not path.is_file():
            continue
        try:
            flow = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        flow_id = path.stem
        dedupe_key = str(flow.get("id") or flow_id)
        entry = {
            "id": dedupe_key,
            "name": flow.get("name", flow_id),
            "description": flow.get("description", ""),
            "filename": path.name,
        }

        existing = flows.get(dedupe_key)
        if existing is None:
            flows[dedupe_key] = entry
            continue

        canonical_filename = f"{dedupe_key}.json"
        if existing["filename"] != canonical_filename and path.name == canonical_filename:
            flows[dedupe_key] = entry

    return list(flows.values())


def load_flow_data(project_id: str, flow_id: str) -> Dict:
    path = get_flow_dir(project_id) / f"{flow_id}.json"
    if not path.exists():
        return {
            "id": flow_id,
            "name": flow_id,
            "description": "",
            "nodes": [],
            "edges": [],
        }
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {
            "id": flow_id,
            "name": flow_id,
            "description": "",
            "nodes": [],
            "edges": [],
        }


def save_flow_data(project_id: str, flow_id: str, data: Dict) -> None:
    flow_dir = get_flow_dir(project_id)
    flow_dir.mkdir(parents=True, exist_ok=True)
    path = flow_dir / f"{flow_id}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    yaml_content, _ = flow_to_yaml(data)
    write_yaml_file(project_id, flow_id, yaml_content)


def rename_flow_file(project_id: str, old_flow_id: str, new_flow_id: str) -> None:
    flow_dir = get_flow_dir(project_id)
    old_path = flow_dir / f"{old_flow_id}.json"
    new_path = flow_dir / f"{new_flow_id}.json"
    if old_path.exists():
        new_path.write_text(old_path.read_text(encoding="utf-8"), encoding="utf-8")
        old_path.unlink()
    yaml_old = flow_dir / f"{old_flow_id}.yaml"
    yaml_new = flow_dir / f"{new_flow_id}.yaml"
    if yaml_old.exists():
        yaml_new.write_text(yaml_old.read_text(encoding="utf-8"), encoding="utf-8")
        yaml_old.unlink()


def build_project_overview() -> List[Dict]:
    overview: List[Dict] = []
    for project in load_projects():
        project_id = project["id"]
        metadata = load_project_metadata(project_id)
        overview.append(
            {
                "id": project_id,
                "name": metadata.get("name", project_id),
                "description": metadata.get("description", project.get("description", "")),
                "created_at": metadata.get("created_at"),
                "updated_at": metadata.get("updated_at"),
                "flows": list_flows(project_id),
            }
        )
    return overview


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index() -> str:
    projects = build_project_overview()
    active_project_id = request.args.get("project")
    active_flow_id = request.args.get("flow")
    active_project = None
    active_flow = None
    flow_payload = "{}"

    if active_project_id and active_flow_id:
        active_project = next((entry for entry in projects if entry["id"] == active_project_id), None)
        if active_project:
            active_flow = next((flow for flow in active_project.get("flows", []) if flow["id"] == active_flow_id), None)
            if active_flow:
                flow_payload = json.dumps(
                    load_flow_data(active_project_id, active_flow_id), ensure_ascii=False
                )
            else:
                active_project = None
                active_flow = None

    return render_template(
        "index.html",
        projects=projects,
        active_project=active_project,
        active_flow=active_flow,
        flow_data=flow_payload,
    )


@app.post("/project/create")
def create_project() -> Response:
    name = request.form.get("project_name", "").strip()
    description = request.form.get("project_description", "").strip()
    if not name:
        flash("El nombre del proyecto es obligatorio", "error")
        return redirect(url_for("index"))

    slug = slugify(name, prefix="proyecto")
    existing = {project["id"] for project in load_projects()}
    slug = unique_slug(slug, sorted(existing))

    project_dir = get_project_dir(slug)
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "flows").mkdir(exist_ok=True)

    now = datetime.utcnow().isoformat()
    metadata = {
        "id": slug,
        "name": name,
        "description": description,
        "created_at": now,
        "updated_at": now,
    }
    save_project_metadata(slug, metadata)

    projects = load_projects()
    projects.append({"id": slug, "name": name, "description": description, "created_at": now, "updated_at": now})
    save_projects(projects)

    flash("Proyecto creado correctamente", "success")
    return redirect(url_for("index", project=slug))


@app.post("/project/<project_id>/rename")
def rename_project(project_id: str) -> Response:
    new_name = request.form.get("project_name", "").strip()
    description = request.form.get("project_description", "").strip()
    if not new_name:
        flash("El nombre del proyecto es obligatorio", "error")
        return redirect(url_for("index", project=project_id))

    metadata = load_project_metadata(project_id)
    metadata.update(
        {
            "name": new_name,
            "description": description,
            "updated_at": datetime.utcnow().isoformat(),
        }
    )
    save_project_metadata(project_id, metadata)

    projects = load_projects()
    for project in projects:
        if project["id"] == project_id:
            project.update(
                {
                    "name": new_name,
                    "description": description,
                    "updated_at": metadata["updated_at"],
                }
            )
            break
    save_projects(projects)

    flash("Proyecto actualizado", "success")
    return redirect(url_for("index", project=project_id))


@app.post("/project/<project_id>/delete")
def delete_project(project_id: str) -> Response:
    project_dir = get_project_dir(project_id)
    if project_dir.exists():
        shutil.rmtree(project_dir, onerror=_handle_remove_readonly)

    projects = [project for project in load_projects() if project["id"] != project_id]
    save_projects(projects)

    flash("Proyecto eliminado", "success")
    return redirect(url_for("index"))


@app.post("/project/<project_id>/flow/create")
def create_flow(project_id: str) -> Response:
    name = request.form.get("flow_name", "").strip() or "Nuevo flujo"
    description = request.form.get("flow_description", "").strip()
    flow_slug = slugify(name, prefix="flujo")
    existing = {flow["id"] for flow in list_flows(project_id)}
    flow_slug = unique_slug(flow_slug, sorted(existing))

    flow_data = {
        "id": flow_slug,
        "name": name,
        "description": description,
        "nodes": [],
        "edges": [],
    }
    save_flow_data(project_id, flow_slug, flow_data)
    flash("Flujo creado", "success")
    return redirect(url_for("index", project=project_id, flow=flow_slug))


@app.post("/project/<project_id>/flow/<flow_id>/rename")
def rename_flow(project_id: str, flow_id: str) -> Response:
    name = request.form.get("flow_name", "").strip()
    description = request.form.get("flow_description", "").strip()
    if not name:
        flash("El nombre del flujo es obligatorio", "error")
        return redirect(url_for("index", project=project_id, flow=flow_id))

    flow_slug = slugify(name, prefix="flujo")
    existing = {flow["id"] for flow in list_flows(project_id) if flow["id"] != flow_id}
    flow_slug = unique_slug(flow_slug, sorted(existing))

    data = load_flow_data(project_id, flow_id)
    data.update({"id": flow_slug, "name": name, "description": description})
    save_flow_data(project_id, flow_id, data)
    if flow_id != flow_slug:
        rename_flow_file(project_id, flow_id, flow_slug)
    flash("Flujo renombrado", "success")
    return redirect(url_for("index", project=project_id, flow=flow_slug))


@app.post("/project/<project_id>/flow/<flow_id>/delete")
def delete_flow(project_id: str, flow_id: str) -> Response:
    flow_dir = get_flow_dir(project_id)
    json_path = flow_dir / f"{flow_id}.json"
    yaml_path = flow_dir / f"{flow_id}.yaml"
    if json_path.exists():
        json_path.unlink()
    if yaml_path.exists():
        yaml_path.unlink()
    flash("Flujo eliminado", "success")
    return redirect(url_for("index", project=project_id))


@app.get("/project/<project_id>/flow/<flow_id>")
def open_flow_editor(project_id: str, flow_id: str) -> str:
    return redirect(url_for("index", project=project_id, flow=flow_id))


@app.get("/project/<project_id>/validate")
def validate_flow_view(project_id: str):
    project_metadata = load_project_metadata(project_id)
    flows = list_flows(project_id)
    return render_template("validate.html", project=project_metadata, flows=flows)


@app.get("/api/flow/<project_id>/<flow_id>")
def api_load_flow(project_id: str, flow_id: str) -> Response:
    flow_data = load_flow_data(project_id, flow_id)
    return jsonify(flow_data)


@app.post("/api/flow/<project_id>/<flow_id>/save")
def api_save_flow(project_id: str, flow_id: str) -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    flow_data = payload.get("flow_data")
    if not isinstance(flow_data, dict):
        return jsonify({"success": False, "message": "Datos de flujo inválidos"}), 400

    flow_data.setdefault("id", flow_id)
    flow_data.setdefault("name", flow_id)
    flow_data.setdefault("description", "")

    save_flow_data(project_id, flow_id, flow_data)
    return jsonify({"success": True})


@app.post("/api/flow/validate")
def api_validate_flow() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    flow_data = payload.get("flow_data")
    if not isinstance(flow_data, dict):
        return jsonify({"success": False, "message": "Datos de flujo inválidos"}), 400

    result = validate_flow(flow_data)
    return jsonify(result)


@app.post("/import_yaml")
def import_yaml() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    yaml_text = payload.get("yaml")

    if not isinstance(yaml_text, str) or not yaml_text.strip():
        return jsonify({"success": False, "message": "Debes proporcionar contenido YAML."}), 400

    try:
        flow_data = yaml_to_flow(yaml_text)
    except YamlImportError as error:
        return jsonify({"success": False, "message": str(error)}), 400

    return jsonify({"success": True, "flow_data": flow_data})


@app.post("/export_yaml")
def export_yaml() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    project_id = payload.get("project")
    flow_id = payload.get("flow")
    flow_data = payload.get("flow_data")

    if not all([project_id, flow_id, isinstance(flow_data, dict)]):
        return jsonify({"success": False, "message": "Datos incompletos"}), 400

    yaml_content, yaml_dict = flow_to_yaml(flow_data)
    write_yaml_file(project_id, flow_id, yaml_content)

    return jsonify({"success": True, "yaml": yaml_content, "structure": yaml_dict})


@app.errorhandler(404)
def not_found(_: Exception) -> tuple[str, int]:
    return "Recurso no encontrado", 404


if __name__ == "__main__":
    ensure_data_structure()
    app.run(debug=True)
