# Decision Tree Builder

Decision Tree Builder es una aplicación web ligera construida con Flask que permite a analistas y auditores crear, validar y exportar árboles de decisión complejos sin escribir código. El editor visual soporta grafos multirrama, validación robusta con `networkx` y exportación directa a YAML y JPG.

## 🚀 Requisitos

* Python 3.9 o superior.
* Pip para gestionar dependencias.

Las dependencias de la aplicación son:

* [Flask](https://flask.palletsprojects.com/) – servidor web.
* [PyYAML](https://pyyaml.org/) – exportación a formato YAML.
* [networkx](https://networkx.org/) – validación de grafos y cálculo de caminos.
* [Pillow](https://python-pillow.org/) – soporte para generación de imágenes si se quisiera mover la exportación al backend.

## 📦 Instalación

```bash
cd decision_tree_builder
python -m venv .venv
source .venv/bin/activate  # En Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
```

## ▶️ Ejecución

```bash
python app.py
```

La aplicación quedará disponible en <http://localhost:5000>.

## 🗂️ Estructura del proyecto

```
decision_tree_builder/
├── app.py                     # Servidor Flask y endpoints REST
├── requirements.txt
├── README.md
├── data/                      # Persistencia en disco (JSON/YAML)
│   ├── proyectos.json
│   └── demo_project/
│       ├── metadata.json
│       └── flows/
│           └── ejemplo.json
├── static/
│   ├── css/style.css          # Estilos y layout del editor
│   └── js/
│       ├── drawflow.min.js    # Helper simplificado estilo Drawflow
│       ├── editor.js          # Lógica del editor visual
│       └── html2canvas.js     # Exportación cliente-side a JPG
├── templates/
│   ├── index.html             # Listado y gestión de proyectos
│   ├── editor.html            # Editor visual
│   └── validate.html          # Vista auxiliar para validación
└── utils/
    ├── paths.py               # Construcción del grafo y rutas
    ├── validator.py           # Validación de flujos con networkx
    └── yaml_export.py         # Serialización de flujos a YAML
```

## 🧭 Funcionalidades principales

### Gestión de proyectos y flujos

* Crear, renombrar y eliminar proyectos.
* Crear, renombrar y eliminar flujos dentro de cada proyecto.
* Persistencia simple en archivos JSON/YAML dentro de `data/`.

### Editor visual

* Creación de nodos de tipo **pregunta**, **acción** y **mensaje**.
* Conexiones dirigidas etiquetadas entre nodos (múltiples ramas por nodo).
* Arrastre libre, zoom, pan y auto-centrado del lienzo.
* Panel de propiedades contextual para editar campos y metadatos de cada nodo.
* Guardado con `Ctrl + S`, validación con `Ctrl + P`, exportación YAML `Ctrl + E` y JPG `Ctrl + J`.

### Validación

El endpoint `/api/flow/validate` utiliza `utils/validator.py` para comprobar:

* IDs únicos y presentes.
* Conexiones válidas (nodos existentes).
* Ausencia de ciclos usando `networkx.find_cycle`.
* Existencia de nodos raíz y terminales.
* Coherencia entre `expected_answers` y las etiquetas de las aristas.
* Generación de todos los caminos simples raíz → terminal.

El resultado se muestra en un modal indicando errores, advertencias y rutas posibles.

### Exportaciones

* **YAML**: `/export_yaml` genera y guarda `data/<proyecto>/flows/<flujo>.yaml` usando `utils/yaml_export.py`. El YAML se muestra también en pantalla para su revisión.
* **JPG**: el botón “Exportar JPG” utiliza un renderizado canvas cliente-side para capturar el diagrama.

## 🧪 Flujo de ejemplo

Se incluye el proyecto `demo_project` con el flujo `ejemplo.json`, compuesto por tres nodos conectados:

```
greeting (pregunta) ──sí──▶ identification (acción) ──completado──▶ closing (mensaje)
└─no──────────────────────────────────────────────────────────────▶ closing
```

Puedes abrirlo desde la página principal para explorar todas las herramientas del editor.

## 📝 Licencia

Este proyecto se entrega como parte de un ejercicio técnico. Puedes modificarlo libremente para adaptarlo a tus necesidades internas.
