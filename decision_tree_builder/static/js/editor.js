(function () {
  const config = window.APP_CONFIG || {};
  const flowData = typeof config.flowData === 'string' ? JSON.parse(config.flowData || '{}') : config.flowData || {};
  const drawflow = document.getElementById('drawflow');
  const workspace = document.getElementById('workspace');
  const nodesLayer = document.getElementById('nodes-layer');
  const connectionLayer = document.getElementById('connection-layer');
  const labelLayer = document.getElementById('edge-label-layer');
  const propertiesPanel = document.getElementById('properties-panel');
  const propertiesContent = document.getElementById('properties-content');
  const statusBar = document.getElementById('status-bar');
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');
  const drawflowHelper = new (window.SimpleDrawflow || function () {})();
  const layout = document.querySelector('.editor-layout');
  const toolboxPanel = document.querySelector('.toolbox');
  const panelResizers = document.querySelectorAll('.panel-resizer');

  const NODE_TYPE_LABELS = {
    question: 'Pregunta',
    action: 'Acción',
    message: 'Mensaje'
  };

  const state = {
    nodes: new Map(),
    edges: new Map(),
    counters: {
      question: 0,
      action: 0,
      message: 0
    },
    selectedNodeId: null,
    linking: null,
    tempPath: null,
    isDirty: false,
    view: {
      scale: 1,
      translateX: 0,
      translateY: 0
    }
  };

  const domNodes = new Map();
  const domEdges = new Map();
  const edgeLabels = new Map();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getNodeTypeLabel(type) {
    return NODE_TYPE_LABELS[type] || 'Nodo';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatText(value, fallback = '-') {
    if (value === null || value === undefined) {
      return fallback;
    }
    const text = String(value).trim();
    return text ? escapeHtml(text) : fallback;
  }

  function formatMultilineText(value, fallback = '-') {
    if (value === null || value === undefined) {
      return fallback;
    }
    const text = String(value).trim();
    return text ? escapeHtml(text).replace(/\r?\n/g, '<br />') : fallback;
  }

  function formatList(values, fallback = '-') {
    if (!Array.isArray(values) || values.length === 0) {
      return fallback;
    }
    return values.map((item) => escapeHtml(String(item))).join(', ');
  }

  function formatJsonForDisplay(data) {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return '-';
    }
    try {
      return escapeHtml(JSON.stringify(data, null, 2));
    } catch (error) {
      return '-';
    }
  }

  function toWorkspace(clientX, clientY) {
    const rect = drawflow.getBoundingClientRect();
    const x = (clientX - rect.left - state.view.translateX) / state.view.scale;
    const y = (clientY - rect.top - state.view.translateY) / state.view.scale;
    return { x, y };
  }

  function applyTransform() {
    workspace.style.transform = `translate(${state.view.translateX}px, ${state.view.translateY}px) scale(${state.view.scale})`;
    updateEdgePositions();
  }

  function sanitizeId(value) {
    return (value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'nodo';
  }

  function generateNodeId(type) {
    const base = type.toLowerCase();
    state.counters[type] = (state.counters[type] || 0) + 1;
    let candidate = `${base}_${state.counters[type]}`;
    while (state.nodes.has(candidate)) {
      state.counters[type] += 1;
      candidate = `${base}_${state.counters[type]}`;
    }
    return candidate;
  }

  function snap(value) {
    const step = 10;
    return Math.round(value / step) * step;
  }

  function markDirty(message) {
    state.isDirty = true;
    if (message) {
      statusBar.textContent = `${message} · No guardado`;
    } else {
      statusBar.textContent = 'Cambios pendientes de guardar.';
    }
  }

  function markClean(message) {
    state.isDirty = false;
    statusBar.textContent = message || 'Flujo guardado correctamente.';
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  function openModal(title, content) {
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    if (typeof content === 'string') {
      modalBody.innerHTML = content;
    } else if (content instanceof Node) {
      modalBody.appendChild(content);
    }
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  function nodeTemplate(node) {
    const element = document.createElement('div');
    element.className = 'node';
    element.dataset.nodeId = node.id;
    element.dataset.type = node.type;
    element.dataset.id = node.id;

    const header = document.createElement('div');
    header.className = `node-header node-type-${node.type}`;
    const title = document.createElement('span');
    title.className = 'node-title';
    title.textContent = node.id;
    const typeBadge = document.createElement('span');
    typeBadge.className = 'node-type';
    typeBadge.textContent = getNodeTypeLabel(node.type);
    header.appendChild(title);
    header.appendChild(typeBadge);

    const body = document.createElement('div');
    body.className = 'node-body';
    body.innerHTML = renderNodeBody(node);

    const inputPort = document.createElement('div');
    inputPort.className = 'port input';
    const outputPort = document.createElement('div');
    outputPort.className = 'port output';

    element.appendChild(header);
    element.appendChild(body);
    element.appendChild(inputPort);
    element.appendChild(outputPort);

    element.style.left = `${node.position.x}px`;
    element.style.top = `${node.position.y}px`;

    element.addEventListener('mousedown', (event) => {
      if (event.target.closest('input, textarea, button')) {
        return;
      }
      selectNode(node.id);
      event.stopPropagation();
    });

    header.addEventListener('dblclick', () => {
      selectNode(node.id);
      focusProperties();
    });

    header.addEventListener('pointerdown', (event) => {
      startNodeDrag(event, node);
    });

    outputPort.addEventListener('click', (event) => {
      event.stopPropagation();
      beginLinking(node.id, outputPort);
    });

    inputPort.addEventListener('click', (event) => {
      event.stopPropagation();
      completeLinking(node.id);
    });

    return element;
  }

  function renderNodeBody(node) {
    if (node.type === 'question') {
      const expected = formatList(Array.isArray(node.expected_answers) ? node.expected_answers : []);
      return `
        <dl class="node-meta">
          <div class="node-meta-row">
            <dt>Pregunta</dt>
            <dd>${formatMultilineText(node.question, 'Sin definir')}</dd>
          </div>
          <div class="node-meta-row">
            <dt>Check</dt>
            <dd>${formatText(node.check, '-')}</dd>
          </div>
          <div class="node-meta-row">
            <dt>Respuestas</dt>
            <dd>${expected}</dd>
          </div>
        </dl>
      `;
    }
    if (node.type === 'action') {
      const parameters = formatJsonForDisplay(node.parameters);
      const parametersClass = parameters === '-' ? '' : ' class="node-meta-code"';
      return `
        <dl class="node-meta">
          <div class="node-meta-row">
            <dt>Acción</dt>
            <dd>${formatText(node.action, 'Sin definir')}</dd>
          </div>
          <div class="node-meta-row">
            <dt>Parámetros</dt>
            <dd${parametersClass}>${parameters}</dd>
          </div>
        </dl>
      `;
    }
    if (node.type === 'message') {
      return `
        <dl class="node-meta">
          <div class="node-meta-row">
            <dt>Mensaje</dt>
            <dd>${formatMultilineText(node.message, 'Sin definir')}</dd>
          </div>
          <div class="node-meta-row">
            <dt>Severidad</dt>
            <dd>${formatText(node.severity, '-')}</dd>
          </div>
        </dl>
      `;
    }
    return '<p>Nodo sin representación.</p>';
  }

  function updateNodeElement(element, node) {
    element.dataset.nodeId = node.id;
    element.dataset.type = node.type;
    element.dataset.id = node.id;
    element.style.left = `${node.position.x}px`;
    element.style.top = `${node.position.y}px`;
    const header = element.querySelector('.node-header');
    const body = element.querySelector('.node-body');
    if (header) {
      header.className = `node-header node-type-${node.type}`;
      let title = header.querySelector('.node-title');
      if (!title) {
        title = document.createElement('span');
        title.className = 'node-title';
        header.insertBefore(title, header.firstChild);
      }
      title.textContent = node.id;
      let typeBadge = header.querySelector('.node-type');
      if (!typeBadge) {
        typeBadge = document.createElement('span');
        typeBadge.className = 'node-type';
        header.appendChild(typeBadge);
      }
      typeBadge.textContent = getNodeTypeLabel(node.type);
    }
    if (body) {
      body.innerHTML = renderNodeBody(node);
    }
  }

  function renderNodes() {
    Array.from(domNodes.keys()).forEach((nodeId) => {
      if (!state.nodes.has(nodeId)) {
        const element = domNodes.get(nodeId);
        if (element) {
          element.remove();
        }
        domNodes.delete(nodeId);
      }
    });

    state.nodes.forEach((node) => {
      let element = domNodes.get(node.id);
      if (!element) {
        element = nodeTemplate(node);
        domNodes.set(node.id, element);
        nodesLayer.appendChild(element);
      } else {
        updateNodeElement(element, node);
      }
    });
  }

  function renderEdges() {
    connectionLayer.innerHTML = '';
    labelLayer.innerHTML = '';
    domEdges.clear();
    edgeLabels.clear();

    state.edges.forEach((edge) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('connection-path');
      path.dataset.edgeId = edge.id;
      connectionLayer.appendChild(path);
      domEdges.set(edge.id, path);

      const label = document.createElement('div');
      label.className = 'edge-label';
      label.dataset.edgeId = edge.id;
      label.textContent = edge.label || '';
      label.title = 'Click para editar etiqueta. Doble click para eliminar.';
      labelLayer.appendChild(label);
      edgeLabels.set(edge.id, label);

      label.addEventListener('click', () => {
        const current = edge.label || '';
        const value = window.prompt('Etiqueta de la conexión', current) ?? current;
        edge.label = value.trim();
        label.textContent = edge.label;
        markDirty('Etiqueta actualizada');
      });

      label.addEventListener('dblclick', (event) => {
        event.preventDefault();
        if (window.confirm('¿Eliminar esta conexión?')) {
          removeEdge(edge.id);
        }
      });
    });

    updateEdgePositions();
  }

  function updateEdgePositions() {
    state.edges.forEach((edge) => {
      const pathEl = domEdges.get(edge.id);
      const labelEl = edgeLabels.get(edge.id);
      if (!pathEl || !labelEl) {
        return;
      }
      const sourceEl = domNodes.get(edge.source);
      const targetEl = domNodes.get(edge.target);
      if (!sourceEl || !targetEl) {
        return;
      }
      const outputPort = sourceEl.querySelector('.port.output');
      const inputPort = targetEl.querySelector('.port.input');
      if (!outputPort || !inputPort) {
        return;
      }
      const outputRect = outputPort.getBoundingClientRect();
      const inputRect = inputPort.getBoundingClientRect();
      const source = toWorkspace(outputRect.left + outputRect.width / 2, outputRect.top + outputRect.height / 2);
      const target = toWorkspace(inputRect.left + inputRect.width / 2, inputRect.top + inputRect.height / 2);
      const d = window.SimpleDrawflow ? window.SimpleDrawflow.cubicPath(source, target) : `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
      pathEl.setAttribute('d', d);
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      labelEl.style.left = `${midX}px`;
      labelEl.style.top = `${midY}px`;
    });
  }

  function setupResizablePanels() {
    if (!layout || !panelResizers.length) {
      return;
    }
    const panels = {
      toolbox: {
        element: toolboxPanel,
        cssVar: '--toolbox-width',
        min: 220,
        max: 440,
        direction: 1
      },
      properties: {
        element: propertiesPanel,
        cssVar: '--properties-width',
        min: 240,
        max: 460,
        direction: -1
      }
    };

    panelResizers.forEach((resizer) => {
      const key = resizer.dataset.panel;
      const config = key ? panels[key] : null;
      if (!config || !config.element) {
        return;
      }
      resizer.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startWidth = config.element.getBoundingClientRect().width;
        resizer.setPointerCapture(pointerId);
        resizer.classList.add('active');
        document.body.classList.add('panel-resizing');

        const handleMove = (moveEvent) => {
          if (moveEvent.pointerId !== pointerId) {
            return;
          }
          const delta = moveEvent.clientX - startX;
          const proposed = config.direction === 1 ? startWidth + delta : startWidth - delta;
          const width = clamp(proposed, config.min, config.max);
          layout.style.setProperty(config.cssVar, `${width}px`);
          updateEdgePositions();
        };

        const stopResize = (endEvent) => {
          if (endEvent.pointerId !== pointerId) {
            return;
          }
          resizer.removeEventListener('pointermove', handleMove);
          resizer.removeEventListener('pointerup', stopResize);
          resizer.removeEventListener('pointercancel', stopResize);
          resizer.releasePointerCapture(pointerId);
          resizer.classList.remove('active');
          document.body.classList.remove('panel-resizing');
          updateEdgePositions();
        };

        resizer.addEventListener('pointermove', handleMove);
        resizer.addEventListener('pointerup', stopResize);
        resizer.addEventListener('pointercancel', stopResize);
      });
    });
  }

  function selectNode(nodeId) {
    state.selectedNodeId = nodeId;
    domNodes.forEach((element, id) => {
      element.classList.toggle('selected', id === nodeId);
    });
    const node = nodeId ? state.nodes.get(nodeId) : null;
    if (node) {
      renderProperties(node);
    } else {
      propertiesContent.innerHTML = '<p class="empty">Selecciona un nodo para editar sus propiedades.</p>';
    }
  }

  function focusProperties() {
    const firstInput = propertiesContent.querySelector('input, textarea');
    if (firstInput) {
      firstInput.focus();
    }
  }

  function startNodeDrag(event, node) {
    event.preventDefault();
    const pointerId = event.pointerId;
    const start = toWorkspace(event.clientX, event.clientY);
    const origin = { ...node.position };
    const element = domNodes.get(node.id);
    if (!element) return;
    element.setPointerCapture(pointerId);

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const point = toWorkspace(moveEvent.clientX, moveEvent.clientY);
      node.position.x = snap(origin.x + point.x - start.x);
      node.position.y = snap(origin.y + point.y - start.y);
      updateNodeElement(element, node);
      updateEdgePositions();
      markDirty();
    };

    const onUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.releasePointerCapture(pointerId);
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
  }

  function beginLinking(sourceId, portElement) {
    state.linking = {
      sourceId,
      tempTarget: null
    };
    if (!state.tempPath) {
      state.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      state.tempPath.classList.add('connection-path', 'active');
      connectionLayer.appendChild(state.tempPath);
    }
    drawflow.style.cursor = 'crosshair';
  }

  function updateTempLink(clientX, clientY) {
    if (!state.linking || !state.tempPath) return;
    const sourceEl = domNodes.get(state.linking.sourceId);
    if (!sourceEl) return;
    const outputPort = sourceEl.querySelector('.port.output');
    if (!outputPort) return;
    const outputRect = outputPort.getBoundingClientRect();
    const source = toWorkspace(outputRect.left + outputRect.width / 2, outputRect.top + outputRect.height / 2);
    const target = toWorkspace(clientX, clientY);
    const d = window.SimpleDrawflow ? window.SimpleDrawflow.cubicPath(source, target) : `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
    state.tempPath.setAttribute('d', d);
  }

  function completeLinking(targetId) {
    if (!state.linking) return;
    const sourceId = state.linking.sourceId;
    if (!sourceId || sourceId === targetId) {
      cancelLinking();
      return;
    }
    const edgeId = window.SimpleDrawflow ? window.SimpleDrawflow.uuid('edge') : `edge_${Date.now()}`;
    const label = window.prompt('Etiqueta de la conexión', '') || '';
    const edge = { id: edgeId, source: sourceId, target: targetId, label: label.trim() };
    state.edges.set(edgeId, edge);
    cancelLinking();
    renderEdges();
    if (state.selectedNodeId === sourceId || state.selectedNodeId === targetId) {
      const selected = state.nodes.get(state.selectedNodeId);
      if (selected) {
        renderProperties(selected);
      }
    }
    markDirty('Conexión creada');
  }

  function cancelLinking() {
    state.linking = null;
    drawflow.style.cursor = 'grab';
    if (state.tempPath) {
      state.tempPath.remove();
      state.tempPath = null;
    }
  }

  function removeEdge(edgeId) {
    if (state.edges.has(edgeId)) {
      state.edges.delete(edgeId);
      renderEdges();
      markDirty('Conexión eliminada');
      if (state.selectedNodeId) {
        const node = state.nodes.get(state.selectedNodeId);
        if (node) {
          renderProperties(node);
        }
      }
    }
  }

  function removeNode(nodeId) {
    if (!state.nodes.has(nodeId)) return;
    state.nodes.delete(nodeId);
    state.edges.forEach((edge, id) => {
      if (edge.source === nodeId || edge.target === nodeId) {
        state.edges.delete(id);
      }
    });
    renderNodes();
    renderEdges();
    selectNode(null);
    markDirty('Nodo eliminado');
  }

  function handleNodeIdChange(node, newId) {
    const sanitized = sanitizeId(newId);
    if (!sanitized) {
      showToast('El identificador no puede estar vacío.', 'error');
      return;
    }
    if (sanitized !== node.id && state.nodes.has(sanitized)) {
      showToast('Ya existe un nodo con ese identificador.', 'error');
      return;
    }
    const previousId = node.id;
    state.nodes.delete(previousId);
    node.id = sanitized;
    state.nodes.set(node.id, node);
    state.edges.forEach((edge) => {
      if (edge.source === previousId) edge.source = sanitized;
      if (edge.target === previousId) edge.target = sanitized;
    });
    domNodes.delete(previousId);
    renderNodes();
    renderEdges();
    selectNode(sanitized);
    markDirty('ID actualizado');
  }

  function renderProperties(node) {
    propertiesContent.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'properties-form';
    form.innerHTML = '';

    const idField = createLabeledField('Identificador', 'text', node.id);
    idField.input.addEventListener('change', (event) => handleNodeIdChange(node, event.target.value));
    form.appendChild(idField.wrapper);

    if (node.type === 'question') {
      const questionField = createLabeledField('Texto de la pregunta', 'textarea', node.question || '');
      questionField.input.addEventListener('input', (event) => {
        node.question = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      form.appendChild(questionField.wrapper);

      const checkField = createLabeledField('Check', 'text', node.check || '');
      checkField.input.addEventListener('input', (event) => {
        node.check = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      form.appendChild(checkField.wrapper);

      const expectedField = createLabeledField('Respuestas esperadas (separadas por coma)', 'textarea', (node.expected_answers || []).join(', '));
      expectedField.input.addEventListener('blur', (event) => {
        const values = event.target.value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        node.expected_answers = values;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      form.appendChild(expectedField.wrapper);
    }

    if (node.type === 'action') {
      const actionField = createLabeledField('Acción', 'text', node.action || '');
      actionField.input.addEventListener('input', (event) => {
        node.action = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      form.appendChild(actionField.wrapper);

      const paramsField = createLabeledField('Parámetros (JSON)', 'textarea', node.parameters && Object.keys(node.parameters).length ? JSON.stringify(node.parameters, null, 2) : '');
      paramsField.input.addEventListener('blur', (event) => {
        const text = event.target.value.trim();
        if (!text) {
          node.parameters = {};
          markDirty();
          updateNodeElement(domNodes.get(node.id), node);
          return;
        }
        try {
          node.parameters = JSON.parse(text);
          markDirty();
          updateNodeElement(domNodes.get(node.id), node);
          paramsField.input.classList.remove('error');
        } catch (error) {
          paramsField.input.classList.add('error');
          showToast('JSON inválido en parámetros.', 'error');
        }
      });
      form.appendChild(paramsField.wrapper);
    }

    if (node.type === 'message') {
      const messageField = createLabeledField('Mensaje', 'textarea', node.message || '');
      messageField.input.addEventListener('input', (event) => {
        node.message = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      form.appendChild(messageField.wrapper);

      const severityField = createLabeledField('Severidad', 'text', node.severity || '');
      severityField.input.addEventListener('input', (event) => {
        node.severity = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      form.appendChild(severityField.wrapper);
    }

    const metadataField = createLabeledField('Metadata (JSON)', 'textarea', node.metadata && Object.keys(node.metadata).length ? JSON.stringify(node.metadata, null, 2) : '');
    metadataField.input.addEventListener('blur', (event) => {
      const text = event.target.value.trim();
      if (!text) {
        node.metadata = {};
        markDirty();
        return;
      }
      try {
        node.metadata = JSON.parse(text);
        metadataField.input.classList.remove('error');
        markDirty();
      } catch (error) {
        metadataField.input.classList.add('error');
        showToast('JSON inválido en metadata.', 'error');
      }
    });
    form.appendChild(metadataField.wrapper);

    const connections = document.createElement('div');
    connections.className = 'properties-connections';
    const outgoing = getOutgoingEdges(node.id);
    if (outgoing.length) {
      const title = document.createElement('h4');
      title.textContent = 'Conexiones salientes';
      connections.appendChild(title);
      outgoing.forEach((edge) => {
        const row = document.createElement('div');
        row.className = 'connection-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = edge.label || '';
        input.placeholder = 'Etiqueta';
        input.addEventListener('change', (event) => {
          edge.label = event.target.value.trim();
          const labelEl = edgeLabels.get(edge.id);
          if (labelEl) {
            labelEl.textContent = edge.label;
          }
          markDirty();
        });
        const target = document.createElement('span');
        target.textContent = `→ ${edge.target}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn danger';
        remove.textContent = 'Quitar';
        remove.addEventListener('click', () => removeEdge(edge.id));
        row.appendChild(input);
        row.appendChild(target);
        row.appendChild(remove);
        connections.appendChild(row);
      });
    } else {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No hay conexiones salientes.';
      connections.appendChild(empty);
    }

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn danger';
    deleteButton.textContent = 'Eliminar nodo';
    deleteButton.addEventListener('click', () => {
      if (window.confirm('¿Eliminar nodo y sus conexiones?')) {
        removeNode(node.id);
      }
    });

    form.appendChild(connections);
    form.appendChild(deleteButton);
    form.addEventListener('submit', (event) => event.preventDefault());

    propertiesContent.appendChild(form);
  }

  function createLabeledField(label, type, value) {
    const wrapper = document.createElement('label');
    const caption = document.createElement('span');
    caption.className = 'field-label';
    caption.textContent = label;
    let input;
    if (type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = type;
    }
    input.value = value || '';
    input.classList.add('field-control');
    wrapper.appendChild(caption);
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  function getOutgoingEdges(nodeId) {
    const edges = [];
    state.edges.forEach((edge) => {
      if (edge.source === nodeId) {
        edges.push(edge);
      }
    });
    return edges;
  }

  function addNode(type) {
    const id = generateNodeId(type);
    const rect = drawflow.getBoundingClientRect();
    const center = toWorkspace(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const node = {
      id,
      type,
      position: {
        x: snap(center.x + Math.random() * 40 - 20),
        y: snap(center.y + Math.random() * 40 - 20)
      },
      question: '',
      check: '',
      expected_answers: [],
      action: '',
      parameters: {},
      message: '',
      severity: '',
      metadata: {}
    };
    state.nodes.set(id, node);
    renderNodes();
    selectNode(id);
    markDirty('Nodo creado');
  }

  function normaliseNode(node) {
    const result = {
      id: node.id,
      type: node.type,
      position: {
        x: node.position?.x || 0,
        y: node.position?.y || 0
      },
      metadata: node.metadata || {}
    };
    if (node.type === 'question') {
      result.question = node.question || '';
      result.check = node.check || '';
      result.expected_answers = Array.isArray(node.expected_answers) ? node.expected_answers : [];
    }
    if (node.type === 'action') {
      result.action = node.action || '';
      result.parameters = node.parameters && typeof node.parameters === 'object' ? node.parameters : {};
    }
    if (node.type === 'message') {
      result.message = node.message || '';
      result.severity = node.severity || '';
    }
    if (node.description) {
      result.description = node.description;
    }
    return result;
  }

  function buildPayload() {
    const payloadNodes = Array.from(state.nodes.values()).map((node) => {
      const normalized = normaliseNode(node);
      return normalized;
    });
    const payloadEdges = Array.from(state.edges.values()).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label || ''
    }));
    return {
      id: flowData.id || config.flowId,
      name: flowData.name || config.flowName,
      description: flowData.description || config.flowDescription || '',
      nodes: payloadNodes,
      edges: payloadEdges
    };
  }

  async function saveFlow() {
    const payload = buildPayload();
    try {
      const response = await fetch(`/api/flow/${encodeURIComponent(config.projectId)}/${encodeURIComponent(config.flowId)}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow_data: payload })
      });
      if (!response.ok) {
        throw new Error('No se pudo guardar el flujo');
      }
      Object.assign(flowData, payload);
      markClean('Flujo guardado');
      showToast('Flujo guardado correctamente');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function validateFlow() {
    const payload = buildPayload();
    try {
      const response = await fetch('/api/flow/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow_data: payload })
      });
      if (!response.ok) {
        throw new Error('No se pudo validar el flujo');
      }
      const result = await response.json();
      const container = document.createElement('div');
      container.className = 'validation-summary';
      const status = document.createElement('p');
      status.className = result.valid ? 'valid' : 'invalid';
      status.textContent = result.valid ? '✅ El flujo es válido.' : '❌ El flujo tiene problemas.';
      container.appendChild(status);

      if (result.errors && result.errors.length) {
        const errorsTitle = document.createElement('h4');
        errorsTitle.textContent = 'Errores';
        container.appendChild(errorsTitle);
        const list = document.createElement('ul');
        result.errors.forEach((error) => {
          const li = document.createElement('li');
          li.textContent = error;
          list.appendChild(li);
        });
        container.appendChild(list);
      }

      if (result.warnings && result.warnings.length) {
        const warningsTitle = document.createElement('h4');
        warningsTitle.textContent = 'Advertencias';
        container.appendChild(warningsTitle);
        const list = document.createElement('ul');
        result.warnings.forEach((warning) => {
          const li = document.createElement('li');
          li.textContent = warning;
          list.appendChild(li);
        });
        container.appendChild(list);
      }

      if (result.paths && result.paths.length) {
        const pathsTitle = document.createElement('h4');
        pathsTitle.textContent = 'Caminos posibles';
        container.appendChild(pathsTitle);
        const list = document.createElement('ol');
        list.className = 'paths-list';
        result.paths.forEach((path) => {
          const li = document.createElement('li');
          li.textContent = path.join(' → ');
          list.appendChild(li);
        });
        container.appendChild(list);
      }

      openModal('Resultado de la validación', container);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function exportYaml() {
    const payload = buildPayload();
    try {
      const response = await fetch('/export_yaml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: config.projectId, flow: config.flowId, flow_data: payload })
      });
      if (!response.ok) {
        throw new Error('No se pudo exportar el flujo');
      }
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Error desconocido al exportar');
      }
      const pre = document.createElement('pre');
      pre.textContent = result.yaml;
      openModal('YAML generado', pre);
      showToast('YAML exportado y guardado en disco');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function exportJpg() {
    const canvas = await window.html2canvas(workspace);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.download = `${config.flowId || 'flujo'}.jpg`;
    link.click();
    showToast('Imagen generada correctamente');
  }

  function handleKeydown(event) {
    if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      return;
    }
    if (event.key === 'Escape') {
      cancelLinking();
      return;
    }
    if (event.key === 'Delete' && state.selectedNodeId) {
      event.preventDefault();
      removeNode(state.selectedNodeId);
    }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        saveFlow();
      } else if (key === 'p') {
        event.preventDefault();
        validateFlow();
      } else if (key === 'e') {
        event.preventDefault();
        exportYaml();
      } else if (key === 'j') {
        event.preventDefault();
        exportJpg();
      }
    }
  }

  function handleWheel(event) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(1.8, Math.max(0.3, state.view.scale * delta));
    const rect = drawflow.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    state.view.translateX = pointerX - ((pointerX - state.view.translateX) * newScale) / state.view.scale;
    state.view.translateY = pointerY - ((pointerY - state.view.translateY) * newScale) / state.view.scale;
    state.view.scale = newScale;
    applyTransform();
  }

  function setupPan() {
    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    drawflow.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.node')) {
        return;
      }
      isPanning = true;
      startX = event.clientX;
      startY = event.clientY;
      originX = state.view.translateX;
      originY = state.view.translateY;
      drawflow.setPointerCapture(event.pointerId);
    });

    drawflow.addEventListener('pointermove', (event) => {
      if (state.linking) {
        updateTempLink(event.clientX, event.clientY);
      }
      if (!isPanning) return;
      state.view.translateX = originX + (event.clientX - startX);
      state.view.translateY = originY + (event.clientY - startY);
      applyTransform();
    });

    drawflow.addEventListener('pointerup', (event) => {
      if (isPanning) {
        drawflow.releasePointerCapture(event.pointerId);
      }
      isPanning = false;
      cancelLinking();
    });
  }

  function centerView() {
    if (!state.nodes.size) {
      state.view.scale = 1;
      state.view.translateX = drawflow.clientWidth / 2 - 150;
      state.view.translateY = drawflow.clientHeight / 2 - 120;
      applyTransform();
      return;
    }
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    state.nodes.forEach((node) => {
      bounds.minX = Math.min(bounds.minX, node.position.x);
      bounds.minY = Math.min(bounds.minY, node.position.y);
      bounds.maxX = Math.max(bounds.maxX, node.position.x + 260);
      bounds.maxY = Math.max(bounds.maxY, node.position.y + 160);
    });
    const width = bounds.maxX - bounds.minX + 100;
    const height = bounds.maxY - bounds.minY + 100;
    const availableWidth = drawflow.clientWidth;
    const availableHeight = drawflow.clientHeight;
    const scale = Math.min(availableWidth / width, availableHeight / height, 1.5);
    state.view.scale = Math.max(0.4, scale);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    state.view.translateX = availableWidth / 2 - centerX * state.view.scale;
    state.view.translateY = availableHeight / 2 - centerY * state.view.scale;
    applyTransform();
  }

  function initialise() {
    const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
    const edges = Array.isArray(flowData.edges) ? flowData.edges : [];

    nodes.forEach((node) => {
      if (!node.id || !node.type) {
        return;
      }
      const prepared = {
        id: node.id,
        type: node.type,
        position: {
          x: node.position?.x ?? 120,
          y: node.position?.y ?? 120
        },
        question: node.question || '',
        check: node.check || '',
        expected_answers: Array.isArray(node.expected_answers) ? node.expected_answers : [],
        action: node.action || '',
        parameters: node.parameters && typeof node.parameters === 'object' ? node.parameters : {},
        message: node.message || '',
        severity: node.severity || '',
        metadata: node.metadata && typeof node.metadata === 'object' ? node.metadata : {}
      };
      state.nodes.set(prepared.id, prepared);
      const match = prepared.id.match(/(question|action|message)_(\d+)/i);
      if (match) {
        const type = match[1].toLowerCase();
        const number = parseInt(match[2], 10);
        if (!Number.isNaN(number)) {
          state.counters[type] = Math.max(state.counters[type] || 0, number);
        }
      }
    });

    edges.forEach((edge) => {
      if (!edge.id || !edge.source || !edge.target) {
        return;
      }
      state.edges.set(edge.id, {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label || ''
      });
    });

    renderNodes();
    renderEdges();
    centerView();
  }

  function setupToolbar() {
    document.querySelectorAll('[data-node-type]').forEach((button) => {
      button.addEventListener('click', () => {
        addNode(button.dataset.nodeType);
      });
    });
    document.getElementById('btn-save').addEventListener('click', saveFlow);
    document.getElementById('btn-validate').addEventListener('click', validateFlow);
    document.getElementById('btn-export-yaml').addEventListener('click', exportYaml);
    document.getElementById('btn-export-jpg').addEventListener('click', exportJpg);
    document.getElementById('btn-center').addEventListener('click', centerView);
  }

  window.addEventListener('beforeunload', (event) => {
    if (state.isDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.addEventListener('keydown', handleKeydown);
  drawflow.addEventListener('wheel', handleWheel, { passive: false });
  setupResizablePanels();
  setupPan();
  setupToolbar();
  initialise();
  window.addEventListener('resize', updateEdgePositions);
})();
