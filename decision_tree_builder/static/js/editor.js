(function () {
  const config = window.APP_CONFIG || {};
  const flowData = typeof config.flowData === 'string' ? JSON.parse(config.flowData || '{}') : config.flowData || {};
  const drawflow = document.getElementById('drawflow');
  const workspace = document.getElementById('workspace');
  const nodesLayer = document.getElementById('nodes-layer');
  const connectionLayer = document.getElementById('connection-layer');
  const propertiesPanel = document.getElementById('properties-panel');
  const propertiesContent = document.getElementById('properties-content');
  const statusBar = document.getElementById('status-bar');
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');
  const layout = document.querySelector('.editor-layout');
  const toolboxPanel = document.querySelector('.toolbox');
  const panelResizers = document.querySelectorAll('.panel-resizer');
  const propertiesToggle = document.getElementById('btn-toggle-properties');
  const hidePropertiesButton = document.getElementById('btn-hide-properties');
  const fullscreenButton = document.getElementById('btn-toggle-fullscreen');

  const PROPERTIES_MIN_WIDTH = 260;
  const PROPERTIES_MAX_WIDTH = 520;
  const PROPERTIES_DEFAULT_WIDTH = 368;
  const DEFAULT_PROPERTIES_MESSAGE =
    '<p class="empty">Selecciona un nodo para editar sus propiedades.</p>';

  const NODE_TYPE_LABELS = {
    question: 'Pregunta',
    message: 'Mensaje'
  };

  function normaliseTitleValue(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function formatIdAsTitle(identifier) {
    if (!identifier) {
      return '';
    }
    const parts = String(identifier)
      .split(/[_-]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) {
      const trimmed = String(identifier).trim();
      return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : '';
    }
    return parts
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
      .join(' ');
  }

  function deriveInitialTitle(node) {
    if (!node || typeof node !== 'object') {
      return 'Nodo';
    }
    const explicit = normaliseTitleValue(node.title);
    if (explicit) {
      return explicit;
    }
    const metadata = node.metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const metadataTitle = normaliseTitleValue(metadata.title);
      if (metadataTitle) {
        return metadataTitle;
      }
    }
    return formatIdAsTitle(node.id) || getNodeTypeLabel(node.type) || 'Nodo';
  }

  function getNodeTitle(node) {
    if (!node || typeof node !== 'object') {
      return 'Nodo';
    }
    return normaliseTitleValue(node.title) || formatIdAsTitle(node.id) || getNodeTypeLabel(node.type) || 'Nodo';
  }

  const state = {
    nodes: new Map(),
    edges: new Map(),
    counters: {
      question: 0,
      message: 0
    },
    selectedNodeId: null,
    selectedEdgeId: null,
    linking: null,
    tempPath: null,
    isDirty: false,
    view: {
      scale: 1,
      translateX: 0,
      translateY: 0
    }
  };

  const linkingHandlers = { move: null, up: null };
  let isPropertiesCollapsed = false;
  let lastExpandedPropertiesWidth = PROPERTIES_DEFAULT_WIDTH;

  const domNodes = new Map();
  const domEdges = new Map();
  const portElements = new Map();
  const dirtyListeners = new Set();

  function notifyDirtyChange() {
    if (document.body && document.body.classList) {
      document.body.classList.toggle('has-unsaved-changes', state.isDirty);
    }
    dirtyListeners.forEach((listener) => {
      try {
        listener(state.isDirty);
      } catch (error) {
        // Ignore errors thrown by listener callbacks to avoid breaking the editor.
      }
    });
  }

  function ensureConnectionLayerVisibility() {
    if (!connectionLayer) {
      return;
    }
    if (connectionLayer.style.overflow !== 'visible') {
      connectionLayer.style.overflow = 'visible';
    }
    if (connectionLayer.getAttribute('overflow') !== 'visible') {
      connectionLayer.setAttribute('overflow', 'visible');
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getNumericCssVar(element, variableName, fallback = Number.NaN) {
    if (!element) {
      return fallback;
    }
    const computed = window.getComputedStyle(element).getPropertyValue(variableName);
    const parsed = parseFloat(computed);
    return Number.isFinite(parsed) ? parsed : fallback;
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

  function sanitizePortLabel(value, fallback = 'salida') {
    const base = (value || '').toString().trim();
    if (!base) {
      return fallback;
    }
    return base;
  }

  function portKeyFromLabel(label) {
    return sanitizeId(label || 'salida');
  }

  function normaliseAnswer(value) {
    return (value || '').toString().trim();
  }

  function normaliseColorValue(value) {
    const raw = (value || '').toString().trim();
    if (!raw) {
      return '';
    }
    if (/^#([0-9a-fA-F]{6})$/.test(raw)) {
      return raw.toLowerCase();
    }
    const short = raw.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      const [r, g, b] = short[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return '';
  }

  function coerceExpectedAnswers(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const result = [];
    value.forEach((entry) => {
      if (entry === null || entry === undefined) {
        return;
      }
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        const valueCandidate =
          entry.value !== undefined
            ? entry.value
            : entry.label !== undefined
            ? entry.label
            : entry.answer !== undefined
            ? entry.answer
            : null;
        if (valueCandidate !== null && valueCandidate !== undefined) {
          const valueText = String(valueCandidate).trim();
          if (!valueText) {
            return;
          }
          const descriptionCandidate =
            entry.description !== undefined
              ? entry.description
              : entry.text !== undefined
              ? entry.text
              : entry.explanation !== undefined
              ? entry.explanation
              : '';
          const descriptionText =
            descriptionCandidate === null || descriptionCandidate === undefined
              ? ''
              : String(descriptionCandidate).trim();
          result.push({ value: valueText, description: descriptionText });
          return;
        }
        const pairs = Object.entries(entry);
        if (pairs.length === 1) {
          const [key, val] = pairs[0];
          const valueText = String(key).trim();
          if (!valueText) {
            return;
          }
          const descriptionText = val === null || val === undefined ? '' : String(val).trim();
          result.push({ value: valueText, description: descriptionText });
        }
        return;
      }
      const valueText = String(entry).trim();
      if (!valueText) {
        return;
      }
      result.push({ value: valueText, description: '' });
    });
    return result;
  }

  function serialiseExpectedAnswers(value) {
    return coerceExpectedAnswers(value).map((entry) => {
      const output = { value: entry.value };
      if (entry.description) {
        output.description = entry.description;
      }
      return output;
    });
  }

  function expectedAnswersToText(value) {
    return coerceExpectedAnswers(value)
      .map((entry) => {
        if (entry.description) {
          return `- ${entry.value}: ${entry.description}`;
        }
        return `- ${entry.value}`;
      })
      .join('\n');
  }

  function parseExpectedAnswersInput(value) {
    const lines = String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim());
    const entries = [];
    lines.forEach((line) => {
      if (!line) {
        return;
      }
      const cleaned = line.startsWith('-') ? line.slice(1).trim() : line;
      if (!cleaned) {
        return;
      }
      const [answerPart, ...descriptionParts] = cleaned.split(':');
      const answer = (answerPart || '').trim();
      if (!answer) {
        return;
      }
      const description = descriptionParts.join(':').trim();
      const entry = { value: answer };
      if (description) {
        entry.description = description;
      }
      entries.push(entry);
    });
    return serialiseExpectedAnswers(entries);
  }

  function formatExpectedAnswersForDisplay(answers) {
    const items = coerceExpectedAnswers(answers);
    if (!items.length) {
      return '-';
    }
    const list = items
      .map((item) => {
        const value = escapeHtml(item.value);
        const description = item.description ? formatMultilineText(item.description, '') : '';
        if (description) {
          return `
            <li class="expected-answer-item">
              <span class="expected-answer-value">${value}</span>
              <span class="expected-answer-description">${description}</span>
            </li>
          `;
        }
        return `
          <li class="expected-answer-item">
            <span class="expected-answer-value">${value}</span>
          </li>
        `;
      })
      .join('');
    return `<ul class="expected-answer-list">${list}</ul>`;
  }

  function setNodeVariable(element, name, value) {
    if (!element) return;
    if (value) {
      element.style.setProperty(name, value);
    } else {
      element.style.removeProperty(name);
    }
  }

  function makePortKey(nodeId, type, portId) {
    return `${nodeId}::${type}::${portId}`;
  }

  function registerPort(nodeId, type, portId, element) {
    portElements.set(makePortKey(nodeId, type, portId), element);
  }

  function unregisterPorts(nodeId) {
    const prefix = `${nodeId}::`;
    Array.from(portElements.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        portElements.delete(key);
      }
    });
  }

  function getPortElement(nodeId, type, portId) {
    return portElements.get(makePortKey(nodeId, type, portId));
  }

  function getPortAnchorPoint(portElement) {
    if (!portElement) {
      return null;
    }
    const rect = portElement.getBoundingClientRect();
    const type = portElement.dataset.portType;
    if (type === 'output') {
      return {
        x: rect.right,
        y: rect.top + rect.height / 2
      };
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
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

  function generateEdgeId() {
    const random = Math.random().toString(16).slice(2, 10);
    return `edge_${Date.now().toString(16)}_${random}`;
  }

  function computeConnectionPath(source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const horizontalOffset = Math.max(Math.abs(dx) * 0.45, 80);
    let c1x = source.x + horizontalOffset;
    let c1y = source.y;
    let c2x = target.x - horizontalOffset;
    let c2y = target.y;

    if (dx < 0) {
      const extra = Math.max(120, Math.abs(dx) * 0.6);
      const vertical = Math.max(60, Math.abs(dy) || 40);
      const direction = dy >= 0 ? 1 : -1;
      c1x = source.x + extra;
      c1y = source.y + direction * vertical;
      c2x = target.x - extra;
      c2y = target.y - direction * vertical;
    }

    return `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
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
    notifyDirtyChange();
  }

  function markClean(message) {
    state.isDirty = false;
    statusBar.textContent = message || 'Flujo guardado correctamente.';
    notifyDirtyChange();
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

  function applyNodeAppearance(element, node) {
    if (!element) return;
    const appearance = node.appearance || {};
    setNodeVariable(element, '--node-border-color', appearance.borderColor || '');
    setNodeVariable(element, '--node-body-bg', appearance.bodyBackground || '');
    setNodeVariable(element, '--node-body-text', appearance.bodyText || '');
    setNodeVariable(element, '--node-header-bg', appearance.headerBackground || '');
    setNodeVariable(element, '--node-header-text', appearance.headerText || '');
  }

  function nodeTemplate(node) {
    const element = document.createElement('div');
    element.className = 'node';
    element.dataset.nodeId = node.id;
    element.dataset.type = node.type;
    element.dataset.id = node.id;

    const surface = document.createElement('div');
    surface.className = 'node-surface';

    const header = document.createElement('div');
    header.className = 'node-header';
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

    surface.appendChild(header);
    surface.appendChild(body);
    element.appendChild(surface);

    element.style.left = `${node.position.x}px`;
    element.style.top = `${node.position.y}px`;
    applyNodeAppearance(element, node);

    element.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
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

    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target.closest('input, textarea, button, select, a')) {
        return;
      }
      event.stopPropagation();
      selectNode(node.id);
      startNodeDrag(event, node);
    });

    refreshNodePorts(element, node);

    return element;
  }

  function attachPortEvents(port, node, type) {
    port.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      if (type === 'output') {
        beginLinking(node.id, port, event);
      }
    });

    if (type === 'input') {
      port.addEventListener('pointerenter', () => {
        if (state.linking) {
          port.classList.add('is-target');
        }
      });
      port.addEventListener('pointerleave', () => {
        port.classList.remove('is-target');
      });
    }
  }

  function refreshNodePorts(element, node) {
    if (!element) return;
    element.querySelectorAll('.port').forEach((port) => port.remove());
    unregisterPorts(node.id);

    const inputPort = document.createElement('button');
    inputPort.type = 'button';
    inputPort.className = 'port input';
    inputPort.dataset.nodeId = node.id;
    inputPort.dataset.portType = 'input';
    inputPort.dataset.portId = 'input';
    inputPort.innerHTML = '<span>+</span>';
    const nodeDisplayName = getNodeTitle(node);
    inputPort.title = `Entrada de ${nodeDisplayName}`;
    attachPortEvents(inputPort, node, 'input');
    element.appendChild(inputPort);
    registerPort(node.id, 'input', 'input', inputPort);

    const outputs = [];
    if (node.type === 'question') {
      const answers = coerceExpectedAnswers(node.expected_answers);
      const seen = new Set();
      answers.forEach((entry, index) => {
        const label = entry.value;
        const sanitizedLabel = sanitizePortLabel(label);
        if (!sanitizedLabel) {
          return;
        }
        let portId = portKeyFromLabel(sanitizedLabel);
        while (seen.has(portId)) {
          portId = `${portId}_${index + 1}`;
        }
        seen.add(portId);
        outputs.push({ id: portId, label });
      });
      if (!outputs.length) {
        outputs.push({ id: 'salida', label: 'Salida' });
      }
    } else {
      const outgoing = getOutgoingEdges(node.id);
      const seen = new Set();
      outgoing.forEach((edge, index) => {
        const fallback = `Salida ${index + 1}`;
        const label = sanitizePortLabel(edge.label, fallback);
        let portId = edge.sourcePort || edge.source_port || portKeyFromLabel(label);
        if (seen.has(portId)) {
          let suffix = 2;
          while (seen.has(`${portId}_${suffix}`)) {
            suffix += 1;
          }
          portId = `${portId}_${suffix}`;
        }
        seen.add(portId);
        outputs.push({ id: portId, label });
      });
    }

    outputs.forEach((descriptor, index) => {
      const port = document.createElement('button');
      port.type = 'button';
      port.className = 'port output';
      port.dataset.nodeId = node.id;
      port.dataset.portType = 'output';
      port.dataset.portId = descriptor.id;
      port.dataset.portLabel = descriptor.label;
      const displayLabel = descriptor.label || 'Salida';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'port-label';
      labelSpan.textContent = displayLabel;
      port.appendChild(labelSpan);
      port.title = descriptor.label ? `Salida ${descriptor.label}` : 'Salida';
      const position = ((index + 1) / (outputs.length + 1)) * 100;
      port.style.top = `${position}%`;
      attachPortEvents(port, node, 'output');
      element.appendChild(port);
      registerPort(node.id, 'output', descriptor.id, port);
    });
  }

  function refreshNodePortsById(nodeId) {
    if (!nodeId) return;
    const node = state.nodes.get(nodeId);
    if (!node) return;
    const element = domNodes.get(node.id);
    if (!element) return;
    refreshNodePorts(element, node);
  }

  function renderNodeBody(node) {
    if (node.type === 'question') {
      const expected = formatExpectedAnswersForDisplay(node.expected_answers);
      return `
        <dl class="node-meta">
          <div class="node-meta-row">
            <dt>Pregunta</dt>
            <dd>${formatMultilineText(node.question, 'Sin definir')}</dd>
          </div>
          <div class="node-meta-row">
            <dt>Respuestas</dt>
            <dd>${expected}</dd>
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
    applyNodeAppearance(element, node);
    const header = element.querySelector('.node-header');
    const body = element.querySelector('.node-body');
    if (header) {
      let title = header.querySelector('.node-title');
      if (!title) {
        title = document.createElement('span');
        title.className = 'node-title';
        header.insertBefore(title, header.firstChild);
      }
      const displayTitle = getNodeTitle(node);
      const typeLabel = getNodeTypeLabel(node.type);
      title.textContent = displayTitle;
      let typeBadge = header.querySelector('.node-type');
      if (!typeBadge) {
        typeBadge = document.createElement('span');
        typeBadge.className = 'node-type';
        header.appendChild(typeBadge);
      }
      typeBadge.textContent = typeLabel;
      element.setAttribute('aria-label', `${displayTitle} (${typeLabel})`);
    }
    if (body) {
      body.innerHTML = renderNodeBody(node);
    }
    refreshNodePorts(element, node);
  }

  function renderNodes() {
    Array.from(domNodes.keys()).forEach((nodeId) => {
      if (!state.nodes.has(nodeId)) {
        const element = domNodes.get(nodeId);
        if (element) {
          element.remove();
        }
        domNodes.delete(nodeId);
        unregisterPorts(nodeId);
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
    ensureConnectionLayerVisibility();
    connectionLayer.innerHTML = '';
    domEdges.clear();

    state.edges.forEach((edge) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('connection-path');
      path.dataset.edgeId = edge.id;
      path.title = 'Doble click para editar. Clic derecho para eliminar.';
      connectionLayer.appendChild(path);
      domEdges.set(edge.id, path);

      path.addEventListener('click', (event) => {
        event.stopPropagation();
        selectEdge(edge.id);
      });

      path.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        const current = edge.label || '';
        const value = window.prompt('Etiqueta de la conexión', current) ?? current;
        const [answerPart] = (value || '').split(':');
        const trimmed = (answerPart || '').trim();
        if (trimmed === edge.label) {
          return;
        }
        edge.label = trimmed;
        const normalized = normaliseAnswer(edge.label);
        if (normalized) {
          edge.sourcePort = portKeyFromLabel(normalized);
        }
        refreshNodePortsById(edge.source);
        if (state.selectedNodeId === edge.source) {
          const node = state.nodes.get(edge.source);
          if (node) {
            renderProperties(node);
          }
        }
        markDirty('Etiqueta actualizada');
        updateEdgePositions();
      });

      path.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeEdge(edge.id);
      });
    });

    updateEdgePositions();
    updateEdgeSelection();
  }

  function updateEdgePositions() {
    ensureConnectionLayerVisibility();
    state.edges.forEach((edge) => {
      const pathEl = domEdges.get(edge.id);
      if (!pathEl) {
        return;
      }
      const sourcePortId = edge.sourcePort || edge.source_port || (edge.label ? portKeyFromLabel(edge.label) : 'salida');
      const targetPortId = edge.targetPort || edge.target_port || 'input';
      const outputPort = getPortElement(edge.source, 'output', sourcePortId) || getPortElement(edge.source, 'output', 'salida');
      const inputPort = getPortElement(edge.target, 'input', targetPortId) || getPortElement(edge.target, 'input', 'input');
      if (!outputPort || !inputPort) {
        pathEl.style.display = 'none';
        return;
      }
      pathEl.style.display = '';
      const sourceAnchor = getPortAnchorPoint(outputPort);
      const targetAnchor = getPortAnchorPoint(inputPort);
      if (!sourceAnchor || !targetAnchor) {
        pathEl.style.display = 'none';
        return;
      }
      const source = toWorkspace(sourceAnchor.x, sourceAnchor.y);
      const target = toWorkspace(targetAnchor.x, targetAnchor.y);
      const d = computeConnectionPath(source, target);
      pathEl.setAttribute('d', d);
    });
  }

  function setupResizablePanels() {
    if (!layout || !panelResizers.length) {
      return;
    }
    const panels = {};

    if (toolboxPanel) {
      panels.toolbox = {
        element: toolboxPanel,
        cssVar: '--toolbox-width',
        min: 220,
        max: 440,
        direction: 1
      };
    }

    if (propertiesPanel) {
      panels.properties = {
        element: propertiesPanel,
        cssVar: '--properties-width',
        min: PROPERTIES_MIN_WIDTH,
        max: PROPERTIES_MAX_WIDTH,
        direction: -1
      };
    }

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
        let latestWidth = startWidth;
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
          latestWidth = width;
          updateEdgePositions();
        };

        const stopResize = (endEvent) => {
          if (endEvent.pointerId !== pointerId) {
            return;
          }
          if (key === 'properties') {
            lastExpandedPropertiesWidth = clamp(latestWidth, PROPERTIES_MIN_WIDTH, PROPERTIES_MAX_WIDTH);
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

  function setPropertiesCollapsed(collapsed, options = {}) {
    if (!layout || !propertiesPanel) {
      return isPropertiesCollapsed;
    }
    const nextState = Boolean(collapsed);
    if (!options.force && isPropertiesCollapsed === nextState) {
      return isPropertiesCollapsed;
    }
    const measuredWidth = propertiesPanel.getBoundingClientRect
      ? propertiesPanel.getBoundingClientRect().width
      : 0;
    isPropertiesCollapsed = nextState;
    layout.classList.toggle('is-properties-collapsed', nextState);
    propertiesPanel.classList.toggle('is-collapsed', nextState);
    propertiesPanel.setAttribute('aria-hidden', nextState ? 'true' : 'false');
    if (nextState) {
      if (Number.isFinite(measuredWidth) && measuredWidth > PROPERTIES_MIN_WIDTH) {
        lastExpandedPropertiesWidth = clamp(measuredWidth, PROPERTIES_MIN_WIDTH, PROPERTIES_MAX_WIDTH);
      }
      layout.style.setProperty('--properties-width', '0px');
      propertiesPanel.hidden = true;
    } else {
      const targetWidth = clamp(
        Number.isFinite(lastExpandedPropertiesWidth) ? lastExpandedPropertiesWidth : PROPERTIES_DEFAULT_WIDTH,
        PROPERTIES_MIN_WIDTH,
        PROPERTIES_MAX_WIDTH
      );
      lastExpandedPropertiesWidth = targetWidth;
      propertiesPanel.hidden = false;
      layout.style.setProperty('--properties-width', `${targetWidth}px`);
    }
    if (propertiesToggle) {
      const toggleLabel = nextState ? 'Mostrar propiedades' : 'Ocultar propiedades';
      propertiesToggle.toggleAttribute('hidden', !nextState);
      propertiesToggle.setAttribute('aria-expanded', nextState ? 'false' : 'true');
      propertiesToggle.textContent = toggleLabel;
      propertiesToggle.setAttribute('aria-label', toggleLabel);
      propertiesToggle.setAttribute('title', toggleLabel);
    }
    if (hidePropertiesButton) {
      hidePropertiesButton.setAttribute('aria-expanded', nextState ? 'false' : 'true');
    }
    panelResizers.forEach((resizer) => {
      if (resizer.dataset.panel === 'properties') {
        resizer.toggleAttribute('hidden', nextState);
      }
    });
    window.requestAnimationFrame(() => {
      updateEdgePositions();
    });
    if (!options.silent && statusBar) {
      statusBar.textContent = nextState
        ? 'Panel de propiedades oculto.'
        : 'Panel de propiedades visible.';
    }
    return isPropertiesCollapsed;
  }

  function togglePropertiesPanel(value) {
    const nextState =
      typeof value === 'boolean' ? value : !isPropertiesCollapsed;
    const applied = setPropertiesCollapsed(nextState, { force: true });
    if (applied && propertiesToggle && !propertiesToggle.hasAttribute('hidden')) {
      window.requestAnimationFrame(() => {
        propertiesToggle.focus();
      });
    } else if (!applied && hidePropertiesButton) {
      window.requestAnimationFrame(() => {
        hidePropertiesButton.focus();
      });
    }
  }

  function setupPropertiesToggle() {
    if (!layout || !propertiesPanel) {
      if (propertiesToggle) {
        propertiesToggle.remove();
      }
      return;
    }
    const computedWidth = getNumericCssVar(layout, '--properties-width');
    if (Number.isFinite(computedWidth) && computedWidth > 0) {
      lastExpandedPropertiesWidth = clamp(computedWidth, PROPERTIES_MIN_WIDTH, PROPERTIES_MAX_WIDTH);
    } else {
      lastExpandedPropertiesWidth = PROPERTIES_DEFAULT_WIDTH;
      layout.style.setProperty('--properties-width', `${PROPERTIES_DEFAULT_WIDTH}px`);
    }
    const shouldStartCollapsed = !state.selectedNodeId;
    setPropertiesCollapsed(shouldStartCollapsed, { force: true, silent: true });
    if (propertiesToggle) {
      propertiesToggle.addEventListener('click', (event) => {
        event.preventDefault();
        togglePropertiesPanel(false);
      });
    }
    if (hidePropertiesButton) {
      hidePropertiesButton.addEventListener('click', (event) => {
        event.preventDefault();
        togglePropertiesPanel(true);
      });
    }
  }

  function isFullscreenActive() {
    return (
      document.fullscreenElement === drawflow ||
      document.webkitFullscreenElement === drawflow ||
      document.mozFullScreenElement === drawflow ||
      document.msFullscreenElement === drawflow
    );
  }

  function canRequestFullscreen() {
    if (!drawflow) {
      return false;
    }
    return Boolean(
      drawflow.requestFullscreen ||
        drawflow.webkitRequestFullscreen ||
        drawflow.mozRequestFullScreen ||
        drawflow.msRequestFullscreen
    );
  }

  function updateFullscreenButton() {
    if (!fullscreenButton) {
      return;
    }
    const active = isFullscreenActive();
    fullscreenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    fullscreenButton.textContent = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  }

  function toggleFullscreen() {
    if (!drawflow) {
      return;
    }
    const active = isFullscreenActive();
    if (!active) {
      const request =
        drawflow.requestFullscreen ||
        drawflow.webkitRequestFullscreen ||
        drawflow.mozRequestFullScreen ||
        drawflow.msRequestFullscreen;
      if (request) {
        try {
          const result = request.call(drawflow);
          if (result && typeof result.then === 'function') {
            result.catch(() => {});
          }
        } catch (error) {
          // ignore errors from the Fullscreen API
        }
      }
      return;
    }
    const exit =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (exit) {
      try {
        const outcome = exit.call(document);
        if (outcome && typeof outcome.then === 'function') {
          outcome.catch(() => {});
        }
      } catch (error) {
        // ignore errors from the Fullscreen API
      }
    }
  }

  function setupFullscreenControl() {
    if (!fullscreenButton || !drawflow) {
      return;
    }
    if (!canRequestFullscreen()) {
      fullscreenButton.remove();
      return;
    }
    fullscreenButton.addEventListener('click', (event) => {
      event.preventDefault();
      toggleFullscreen();
    });
    const handleFullscreenChange = () => {
      updateFullscreenButton();
      window.requestAnimationFrame(() => {
        updateEdgePositions();
      });
      if (statusBar) {
        statusBar.textContent = isFullscreenActive()
          ? 'Editor en pantalla completa.'
          : 'Editor en modo ventana.';
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    updateFullscreenButton();
  }

  function selectNode(nodeId, options = {}) {
    state.selectedNodeId = nodeId;
    domNodes.forEach((element, id) => {
      element.classList.toggle('selected', id === nodeId);
    });
    if (!options.keepEdgeSelection) {
      state.selectedEdgeId = null;
      updateEdgeSelection();
    }
    const node = nodeId ? state.nodes.get(nodeId) : null;
    const editModeEnabled = document.body && document.body.classList.contains('is-editing');
    const shouldCollapse = !node || !editModeEnabled;
    setPropertiesCollapsed(shouldCollapse, { silent: true });
    if (node && editModeEnabled) {
      renderProperties(node);
    } else if (!options.keepProperties) {
      propertiesContent.innerHTML = DEFAULT_PROPERTIES_MESSAGE;
    }
  }

  function updateEdgeSelection() {
    domEdges.forEach((path, edgeId) => {
      path.classList.toggle('selected', edgeId === state.selectedEdgeId);
    });
  }

  function selectEdge(edgeId) {
    if (!edgeId || !state.edges.has(edgeId)) {
      state.selectedEdgeId = null;
      updateEdgeSelection();
      return;
    }
    state.selectedEdgeId = edgeId;
    updateEdgeSelection();
    selectNode(null, { keepEdgeSelection: true, keepProperties: true });
  }

  function focusProperties() {
    const firstInput = propertiesContent.querySelector('input, textarea');
    if (firstInput) {
      firstInput.focus();
    }
  }

  function startNodeDrag(event, node) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    const start = toWorkspace(event.clientX, event.clientY);
    const origin = { ...node.position };
    const element = domNodes.get(node.id);
    if (!element) return;
    try {
      element.setPointerCapture(pointerId);
    } catch (error) {
      // Ignore errors when pointer capture is not supported for the pointer type.
    }

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const point = toWorkspace(moveEvent.clientX, moveEvent.clientY);
      node.position.x = snap(origin.x + point.x - start.x);
      node.position.y = snap(origin.y + point.y - start.y);
      updateNodeElement(element, node);
      updateEdgePositions();
      markDirty();
    };

    const endDrag = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      try {
        element.releasePointerCapture(pointerId);
      } catch (error) {
        // Ignore errors when releasing pointer capture is not possible.
      }
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
  }

  function beginLinking(sourceId, portElement, event) {
    const portId = portElement?.dataset?.portId || 'salida';
    const pointerId = event.pointerId;
    if (state.linking) {
      cancelLinking();
    }
    state.linking = {
      sourceId,
      sourcePort: portId,
      pointerId,
      sourceElement: portElement
    };
    if (!state.tempPath) {
      state.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      state.tempPath.classList.add('connection-path', 'active');
      connectionLayer.appendChild(state.tempPath);
    }
    drawflow.classList.add('linking');
    drawflow.style.cursor = 'crosshair';
    updateTempLink(event.clientX, event.clientY);
    linkingHandlers.move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      updateTempLink(moveEvent.clientX, moveEvent.clientY);
    };
    linkingHandlers.up = (upEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      const targetPort = upEvent.target.closest('.port');
      if (targetPort && targetPort.dataset.portType === 'input') {
        completeLinking(targetPort.dataset.nodeId, targetPort.dataset.portId || 'input');
      } else {
        cancelLinking();
      }
    };
    document.addEventListener('pointermove', linkingHandlers.move);
    document.addEventListener('pointerup', linkingHandlers.up, true);
  }

  function updateTempLink(clientX, clientY) {
    if (!state.linking || !state.tempPath) return;
    ensureConnectionLayerVisibility();
    const sourcePort = getPortElement(state.linking.sourceId, 'output', state.linking.sourcePort) || state.linking.sourceElement;
    if (!sourcePort) return;
    const anchor = getPortAnchorPoint(sourcePort);
    if (!anchor) return;
    const source = toWorkspace(anchor.x, anchor.y);
    const target = toWorkspace(clientX, clientY);
    const d = computeConnectionPath(source, target);
    state.tempPath.setAttribute('d', d);
  }

  function teardownLinking() {
    if (linkingHandlers.move) {
      document.removeEventListener('pointermove', linkingHandlers.move);
      linkingHandlers.move = null;
    }
    if (linkingHandlers.up) {
      document.removeEventListener('pointerup', linkingHandlers.up, true);
      linkingHandlers.up = null;
    }
    if (state.tempPath) {
      state.tempPath.remove();
      state.tempPath = null;
    }
    drawflow.classList.remove('linking');
    drawflow.style.cursor = 'grab';
    document.querySelectorAll('.port.is-target').forEach((port) => port.classList.remove('is-target'));
  }

  function completeLinking(targetId, targetPortId = 'input') {
    if (!state.linking) return;
    const { sourceId, sourcePort, sourceElement } = state.linking;
    teardownLinking();
    state.linking = null;
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }
    const sourceNode = state.nodes.get(sourceId);
    const targetNode = state.nodes.get(targetId);
    if (!sourceNode || !targetNode) {
      return;
    }
    const existing = Array.from(state.edges.values()).find((edge) => {
      const port = edge.sourcePort || edge.source_port || (edge.label ? portKeyFromLabel(edge.label) : 'salida');
      return edge.source === sourceId && port === sourcePort;
    });
    if (existing) {
      showToast('Ya existe una conexión para esa salida.', 'error');
      return;
    }
    const port = getPortElement(sourceId, 'output', sourcePort) || sourceElement;
    const defaultLabel = port?.dataset?.portLabel || '';
    const label = sourceNode.type === 'question' ? defaultLabel : defaultLabel;
    const edgeId = generateEdgeId();
    const edge = {
      id: edgeId,
      source: sourceId,
      target: targetId,
      label: (label || '').trim(),
      sourcePort,
      targetPort: targetPortId
    };
    state.edges.set(edgeId, edge);
    refreshNodePortsById(sourceId);
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
    if (!state.linking) {
      teardownLinking();
      return;
    }
    state.linking = null;
    teardownLinking();
  }

  function removeEdge(edgeId) {
    const edge = state.edges.get(edgeId);
    if (!edge) {
      return;
    }
    state.edges.delete(edgeId);
    refreshNodePortsById(edge.source);
    if (state.selectedEdgeId === edgeId) {
      state.selectedEdgeId = null;
    }
    renderEdges();
    markDirty('Conexión eliminada');
    if (state.selectedNodeId) {
      const node = state.nodes.get(state.selectedNodeId);
      if (node) {
        renderProperties(node);
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

  function createTabbedLayout() {
    const container = document.createElement('div');
    container.className = 'properties-tabs';

    const tablist = document.createElement('div');
    tablist.className = 'properties-tablist';
    tablist.setAttribute('role', 'tablist');
    container.appendChild(tablist);

    const panelsContainer = document.createElement('div');
    panelsContainer.className = 'properties-tabpanels';
    container.appendChild(panelsContainer);

    const registry = new Map();

    function addTab(id, label, panel) {
      const tabId = `properties-tab-${id}`;
      const panelId = `properties-panel-${id}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'properties-tab';
      button.id = tabId;
      button.dataset.tabId = id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panelId);
      button.tabIndex = -1;
      button.textContent = label;
      tablist.appendChild(button);

      panel.classList.add('properties-tabpanel');
      panel.id = panelId;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tabId);
      panel.dataset.tabId = id;
      panel.hidden = true;
      panelsContainer.appendChild(panel);

      registry.set(id, { button, panel });

      button.addEventListener('click', () => {
        activateTab(id);
      });
    }

    function activateTab(id) {
      registry.forEach((entry, key) => {
        const isActive = key === id;
        entry.button.classList.toggle('is-active', isActive);
        entry.button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        entry.button.tabIndex = isActive ? 0 : -1;
        entry.panel.classList.toggle('is-active', isActive);
        entry.panel.toggleAttribute('hidden', !isActive);
      });
    }

    return { element: container, addTab, activateTab };
  }

  function renderProperties(node) {
    propertiesContent.innerHTML = '';

    const tabs = createTabbedLayout();
    const configPanel = document.createElement('div');
    const stylePanel = document.createElement('div');

    const configForm = document.createElement('form');
    configForm.className = 'properties-form';
    configPanel.appendChild(configForm);

    const styleForm = document.createElement('form');
    styleForm.className = 'properties-form';
    stylePanel.appendChild(styleForm);

    const titleField = createLabeledField('Título', 'text', getNodeTitle(node));
    titleField.input.placeholder = 'Título del nodo';
    titleField.input.addEventListener('input', (event) => {
      node.title = event.target.value;
      markDirty();
      updateNodeElement(domNodes.get(node.id), node);
    });
    titleField.input.addEventListener('blur', (event) => {
      const value = normaliseTitleValue(event.target.value);
      if (value) {
        node.title = value;
        event.target.value = value;
      } else {
        const fallbackTitle = deriveInitialTitle(node);
        node.title = fallbackTitle;
        event.target.value = fallbackTitle;
      }
      updateNodeElement(domNodes.get(node.id), node);
    });
    configForm.appendChild(titleField.wrapper);

    if (node.type === 'question') {
      const questionField = createLabeledField('Texto de la pregunta', 'textarea', node.question || '');
      questionField.input.addEventListener('input', (event) => {
        node.question = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      configForm.appendChild(questionField.wrapper);

      const expectedValue = expectedAnswersToText(node.expected_answers);
      const expectedField = createLabeledField('Respuestas esperadas', 'textarea', expectedValue);
      expectedField.input.placeholder = '- sí: Ha saludado correctamente';
      expectedField.input.rows = Math.max(3, coerceExpectedAnswers(node.expected_answers).length + 1);
      expectedField.input.addEventListener('blur', (event) => {
        node.expected_answers = parseExpectedAnswersInput(event.target.value);
        const normalisedText = expectedAnswersToText(node.expected_answers);
        event.target.value = normalisedText;
        event.target.rows = Math.max(3, coerceExpectedAnswers(node.expected_answers).length + 1);
        markDirty();
        reconcileQuestionEdges(node);
        updateNodeElement(domNodes.get(node.id), node);
        renderEdges();
      });
      const expectedHint = document.createElement('p');
      expectedHint.className = 'hint';
      expectedHint.innerHTML =
        'Escribe una respuesta por línea usando el formato <code>- respuesta: explicación</code>.';
      expectedField.wrapper.appendChild(expectedHint);
      configForm.appendChild(expectedField.wrapper);
    }

    if (node.type === 'message') {
      const messageField = createLabeledField('Mensaje', 'textarea', node.message || '');
      messageField.input.addEventListener('input', (event) => {
        node.message = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      configForm.appendChild(messageField.wrapper);

      const severityField = createLabeledField('Severidad', 'text', node.severity || '');
      severityField.input.addEventListener('input', (event) => {
        node.severity = event.target.value;
        markDirty();
        updateNodeElement(domNodes.get(node.id), node);
      });
      configForm.appendChild(severityField.wrapper);
    }

    if (!node.appearance || typeof node.appearance !== 'object') {
      node.appearance = {};
    }

    const appearanceFields = document.createElement('div');
    appearanceFields.className = 'color-field-group';

    const colors = [
      { label: 'Fondo de cabecera', key: 'headerBackground' },
      { label: 'Texto de cabecera', key: 'headerText' },
      { label: 'Fondo del cuerpo', key: 'bodyBackground' },
      { label: 'Texto del cuerpo', key: 'bodyText' },
      { label: 'Color de borde', key: 'borderColor' }
    ];

    colors.forEach((definition) => {
      const current = node.appearance?.[definition.key] || '';
      const field = createColorField(definition.label, current, (value) => {
        const appearance = node.appearance || {};
        if (value) {
          appearance[definition.key] = value;
        } else {
          delete appearance[definition.key];
        }
        node.appearance = appearance;
        markDirty();
        applyNodeAppearance(domNodes.get(node.id), node);
      });
      appearanceFields.appendChild(field.wrapper);
    });

    const styleHint = document.createElement('p');
    styleHint.className = 'hint';
    styleHint.textContent = 'Personaliza los colores del nodo. Deja un campo vacío para usar el valor por defecto.';
    styleForm.appendChild(styleHint);
    styleForm.appendChild(appearanceFields);

    const metadataField = createLabeledField(
      'Metadata (JSON)',
      'textarea',
      node.metadata && Object.keys(node.metadata).length ? JSON.stringify(node.metadata, null, 2) : ''
    );
    metadataField.input.addEventListener('blur', (event) => {
      const text = event.target.value.trim();
      if (!text) {
        node.metadata = {};
        metadataField.input.classList.remove('error');
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
    configForm.appendChild(metadataField.wrapper);

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
        input.placeholder = 'Respuesta';
        input.addEventListener('change', (event) => {
          const rawValue = event.target.value || '';
          const [answerPart] = rawValue.split(':');
          const trimmed = (answerPart || '').trim();
          edge.label = trimmed;
          event.target.value = edge.label;
          const normalized = normaliseAnswer(edge.label);
          if (normalized) {
            edge.sourcePort = portKeyFromLabel(normalized);
          }
          markDirty();
          refreshNodePortsById(edge.source);
          renderEdges();
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

    configForm.appendChild(connections);
    configForm.appendChild(deleteButton);

    configForm.addEventListener('submit', (event) => event.preventDefault());
    styleForm.addEventListener('submit', (event) => event.preventDefault());

    tabs.addTab('configuration', 'Configuración', configPanel);
    tabs.addTab('style', 'Estilo', stylePanel);
    tabs.activateTab('configuration');

    propertiesContent.appendChild(tabs.element);
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

  function createColorField(label, initialValue, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'color-field';

    const caption = document.createElement('span');
    caption.className = 'field-label';
    caption.textContent = label;
    wrapper.appendChild(caption);

    const controls = document.createElement('div');
    controls.className = 'color-field-controls';

    const picker = document.createElement('input');
    picker.type = 'color';
    const normalised = normaliseColorValue(initialValue) || '#ffffff';
    picker.value = normalised;

    const text = document.createElement('input');
    text.type = 'text';
    text.value = normaliseColorValue(initialValue) || '';
    text.placeholder = '#RRGGBB';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn secondary';
    reset.textContent = 'Restablecer';

    const applyValue = (value, emit = true) => {
      const cleaned = normaliseColorValue(value);
      if (!cleaned) {
        text.value = '';
        picker.value = '#ffffff';
        if (emit) onChange('');
        return;
      }
      text.value = cleaned;
      picker.value = cleaned;
      if (emit) onChange(cleaned);
    };

    picker.addEventListener('input', (event) => {
      applyValue(event.target.value || '', true);
    });

    text.addEventListener('blur', (event) => {
      const value = event.target.value.trim();
      if (!value) {
        applyValue('', true);
        return;
      }
      const normalisedValue = normaliseColorValue(value);
      if (!normalisedValue) {
        showToast('Color inválido. Usa el formato hexadecimal (#RRGGBB).', 'error');
        return;
      }
      applyValue(normalisedValue, true);
    });

    reset.addEventListener('click', () => {
      applyValue('', true);
    });

    controls.appendChild(picker);
    controls.appendChild(text);
    controls.appendChild(reset);
    wrapper.appendChild(controls);

    return { wrapper, picker, input: text };
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

  function reconcileQuestionEdges(node, options = {}) {
    if (!node || node.type !== 'question') {
      return;
    }
    const silent = Boolean(options.silent);
    const answers = coerceExpectedAnswers(node.expected_answers);
    const matchByKey = new Map();
    answers.forEach((entry) => {
      const normalized = normaliseAnswer(entry.value);
      if (!normalized) {
        return;
      }
      const key = portKeyFromLabel(normalized);
      if (!matchByKey.has(key)) {
        matchByKey.set(key, entry.value);
      }
    });
    let removed = 0;
    state.edges.forEach((edge, id) => {
      if (edge.source !== node.id) {
        return;
      }
      const edgeLabel = normaliseAnswer(edge.label);
      const key = portKeyFromLabel(edgeLabel);
      if (!matchByKey.has(key)) {
        state.edges.delete(id);
        removed += 1;
        return;
      }
      edge.label = matchByKey.get(key);
      edge.sourcePort = key;
    });
    if (removed && !silent) {
      showToast('Se eliminaron conexiones que ya no coinciden con las respuestas.', 'info');
    }
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
      metadata: {},
      appearance: {}
    };
    const typeLabel = getNodeTypeLabel(type);
    const counterValue = state.counters[type] || 1;
    node.title = `${typeLabel} ${counterValue}`;
    if (type === 'question') {
      node.question = '';
      node.expected_answers = serialiseExpectedAnswers([
        { value: 'Sí' },
        { value: 'No' }
      ]);
    }
    if (type === 'message') {
      node.message = '';
      node.severity = '';
    }
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
      result.expected_answers = serialiseExpectedAnswers(node.expected_answers);
    }
    if (node.type === 'message') {
      result.message = node.message || '';
      result.severity = node.severity || '';
    }
    const titleValue = normaliseTitleValue(node.title);
    if (titleValue) {
      result.title = titleValue;
    }
    if (node.description) {
      result.description = node.description;
    }
    const appearance = node.appearance && typeof node.appearance === 'object' ? node.appearance : {};
    if (appearance && Object.keys(appearance).length) {
      result.appearance = appearance;
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
      label: edge.label || '',
      source_port: edge.sourcePort || edge.source_port || '',
      target_port: edge.targetPort || edge.target_port || ''
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

  function handleKeydown(event) {
    if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      return;
    }
    if (event.key === 'Escape') {
      cancelLinking();
      return;
    }
    if (event.key === 'Delete') {
      if (state.selectedEdgeId) {
        event.preventDefault();
        removeEdge(state.selectedEdgeId);
        return;
      }
      if (state.selectedNodeId) {
        event.preventDefault();
        removeNode(state.selectedNodeId);
      }
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
    let panPointerId = null;

    drawflow.addEventListener('pointerdown', (event) => {
      if (event.button !== 2) {
        return;
      }
      event.preventDefault();
      isPanning = true;
      panPointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      originX = state.view.translateX;
      originY = state.view.translateY;
      try {
        drawflow.setPointerCapture(panPointerId);
      } catch (error) {
        // Ignore errors when pointer capture cannot be established.
      }
    });

    drawflow.addEventListener('pointermove', (event) => {
      if (state.linking && event.pointerId === state.linking.pointerId) {
        updateTempLink(event.clientX, event.clientY);
      }
      if (!isPanning || event.pointerId !== panPointerId) return;
      state.view.translateX = originX + (event.clientX - startX);
      state.view.translateY = originY + (event.clientY - startY);
      applyTransform();
    });

    const endPan = (event) => {
      if (isPanning && event.pointerId === panPointerId) {
        try {
          drawflow.releasePointerCapture(panPointerId);
        } catch (error) {
          // Ignore errors when releasing pointer capture is not possible.
        }
        isPanning = false;
        panPointerId = null;
        event.preventDefault();
      }
      if (state.linking && event.pointerId === state.linking.pointerId) {
        cancelLinking();
      }
    };

    drawflow.addEventListener('pointerup', endPan);
    drawflow.addEventListener('pointercancel', endPan);
    drawflow.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });
  }

  function initialise() {
    ensureConnectionLayerVisibility();
    const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
    const edges = Array.isArray(flowData.edges) ? flowData.edges : [];

    nodes.forEach((node) => {
      if (!node.id || !node.type) {
        return;
      }
      const type = node.type === 'action' ? 'message' : node.type;
      const prepared = {
        id: node.id,
        type,
        position: {
          x: node.position?.x ?? 120,
          y: node.position?.y ?? 120
        },
        metadata: node.metadata && typeof node.metadata === 'object' ? { ...node.metadata } : {},
        appearance: node.appearance && typeof node.appearance === 'object' ? { ...node.appearance } : {}
      };
      prepared.title = deriveInitialTitle(node);
      if (type === 'question') {
        prepared.question = node.question || '';
        prepared.expected_answers = serialiseExpectedAnswers(node.expected_answers);
      }
      if (type === 'message') {
        prepared.message = node.message || node.action || '';
        prepared.severity = node.severity || '';
        if (node.type === 'action') {
          const parameters = node.parameters && typeof node.parameters === 'object' ? node.parameters : {};
          if (Object.keys(parameters).length) {
            prepared.metadata = { ...prepared.metadata, action_parameters: parameters };
          }
        }
      }
      state.nodes.set(prepared.id, prepared);
      const match = prepared.id.match(/(question|message)_(\d+)/i);
      if (match) {
        const counterType = match[1].toLowerCase();
        const number = parseInt(match[2], 10);
        if (!Number.isNaN(number)) {
          state.counters[counterType] = Math.max(state.counters[counterType] || 0, number);
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
        label: edge.label || '',
        sourcePort: edge.source_port || edge.sourcePort || (edge.label ? portKeyFromLabel(edge.label) : 'salida'),
        targetPort: edge.target_port || edge.targetPort || 'input'
      });
    });

    state.nodes.forEach((node) => {
      if (node.type === 'question') {
        reconcileQuestionEdges(node, { silent: true });
      }
    });

    renderNodes();
    renderEdges();
  }

  function setupToolbar() {
    ['btn-save', 'btn-validate'].forEach((id) => {
      const elements = document.querySelectorAll(`#${id}`);
      elements.forEach((element, index) => {
        if (index > 0) {
          element.remove();
        }
      });
    });
    document.querySelectorAll('[data-node-type]').forEach((button) => {
      button.addEventListener('click', () => {
        addNode(button.dataset.nodeType);
      });
    });
    const saveButton = document.getElementById('btn-save');
    if (saveButton) {
      saveButton.addEventListener('click', saveFlow);
    }
    const validateButton = document.getElementById('btn-validate');
    if (validateButton) {
      validateButton.addEventListener('click', validateFlow);
    }
    const exportYamlButton = document.getElementById('btn-export-yaml');
    if (exportYamlButton) {
      exportYamlButton.addEventListener('click', exportYaml);
    }
  }

  const editorBridge = {
    isDirty: () => state.isDirty,
    onDirtyChange(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      dirtyListeners.add(listener);
      return () => {
        dirtyListeners.delete(listener);
      };
    },
    markDirty,
    markClean
  };

  window.APP_EDITOR = editorBridge;
  try {
    window.dispatchEvent(new CustomEvent('app-editor:init', { detail: { editor: editorBridge } }));
  } catch (error) {
    // Ignore errors when the CustomEvent constructor is not supported.
  }
  notifyDirtyChange();

  window.addEventListener('beforeunload', (event) => {
    if (state.isDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  function restorePropertiesForView() {
    if (propertiesContent) {
      propertiesContent.innerHTML = DEFAULT_PROPERTIES_MESSAGE;
    }
  }

  function handleEnterEditMode() {
    const selectedNode = state.selectedNodeId ? state.nodes.get(state.selectedNodeId) : null;
    if (selectedNode) {
      renderProperties(selectedNode);
      setPropertiesCollapsed(false, { force: true, silent: true });
    } else {
      restorePropertiesForView();
      setPropertiesCollapsed(false, { force: true, silent: true });
    }
  }

  function handleExitEditMode() {
    restorePropertiesForView();
    setPropertiesCollapsed(true, { force: true, silent: true });
  }

  window.addEventListener('app-editor:enter-edit', handleEnterEditMode);
  window.addEventListener('app-editor:exit-edit', handleExitEditMode);

  document.addEventListener('keydown', handleKeydown);
  drawflow.addEventListener('wheel', handleWheel, { passive: false });
  drawflow.addEventListener('click', (event) => {
    if (event.target.closest('.node') || event.target.closest('.port')) {
      return;
    }
    selectNode(null);
  });
  setupPropertiesToggle();
  setupResizablePanels();
  setupPan();
  setupToolbar();
  setupFullscreenControl();
  initialise();
  window.addEventListener('resize', updateEdgePositions);
})();
