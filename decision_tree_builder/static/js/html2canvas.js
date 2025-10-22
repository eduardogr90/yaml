/*
 * Lightweight html2canvas replacement for Decision Tree Builder.
 * It renders nodes and connections into a canvas using layout information.
 */
(function (global) {
  const TYPE_COLORS = {
    question: '#1d4ed8',
    message: '#7c3aed',
    default: '#334155'
  };

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawNode(ctx, node, offsetX, offsetY) {
    const rect = node.getBoundingClientRect();
    const x = rect.left - offsetX;
    const y = rect.top - offsetY;
    const width = rect.width;
    const height = rect.height;
    const header = node.querySelector('.node-header');
    const body = node.querySelector('.node-body');
    const type = node.dataset.type || 'default';
    const headerHeight = header ? header.getBoundingClientRect().height : Math.min(height, 32);

    ctx.save();
    ctx.fillStyle = TYPE_COLORS[type] || TYPE_COLORS.default;
    roundedRect(ctx, x, y, width, height, 14);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    roundedRect(ctx, x, y + headerHeight, width, height - headerHeight, 14);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillText(header ? header.textContent.trim() : node.dataset.id || 'Nodo', x + 12, y + 22);

    if (body) {
      ctx.fillStyle = '#0f172a';
      ctx.font = '12px Inter, sans-serif';
      const lines = body.innerText.split('\n');
      let textY = y + headerHeight + 18;
      lines.forEach((line) => {
        ctx.fillText(line.trim(), x + 12, textY);
        textY += 16;
      });
    }

    ctx.restore();
  }

  function drawLabel(ctx, label, offsetX, offsetY) {
    const rect = label.getBoundingClientRect();
    const x = rect.left - offsetX;
    const y = rect.top - offsetY;
    const width = rect.width;
    const height = rect.height;
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    roundedRect(ctx, x, y, width, height, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(label.textContent.trim(), x + 8, y + height / 2 + 4);
    ctx.restore();
  }

  function drawConnections(ctx, svg, offsetX, offsetY) {
    const paths = svg.querySelectorAll('path');
    paths.forEach((path) => {
      const d = path.getAttribute('d');
      if (!d) return;
      const p = new Path2D(d);
      ctx.save();
      ctx.translate(-offsetX, -offsetY);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(148,163,184,0.6)';
      ctx.stroke(p);
      ctx.restore();
    });
  }

  function html2canvas(element) {
    return new Promise((resolve) => {
      const rect = element.getBoundingClientRect();
      const nodes = Array.from(element.querySelectorAll('.node'));
      const labels = Array.from(element.querySelectorAll('.edge-label'));
      const svg = element.querySelector('#connection-layer');

      let minX = rect.left;
      let minY = rect.top;
      let maxX = rect.right;
      let maxY = rect.bottom;

      nodes.forEach((node) => {
        const r = node.getBoundingClientRect();
        minX = Math.min(minX, r.left - 30);
        minY = Math.min(minY, r.top - 30);
        maxX = Math.max(maxX, r.right + 30);
        maxY = Math.max(maxY, r.bottom + 30);
      });
      labels.forEach((label) => {
        const r = label.getBoundingClientRect();
        minX = Math.min(minX, r.left - 20);
        minY = Math.min(minY, r.top - 20);
        maxX = Math.max(maxX, r.right + 20);
        maxY = Math.max(maxY, r.bottom + 20);
      });

      const scale = global.devicePixelRatio || 1;
      const width = Math.max(600, Math.ceil((maxX - minX) * scale));
      const height = Math.max(400, Math.ceil((maxY - minY) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(canvas);
        return;
      }

      ctx.scale(scale, scale);
      const offsetX = minX;
      const offsetY = minY;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width / scale, height / scale);

      if (svg) {
        drawConnections(ctx, svg, offsetX, offsetY);
      }
      labels.forEach((label) => drawLabel(ctx, label, offsetX, offsetY));
      nodes.forEach((node) => drawNode(ctx, node, offsetX, offsetY));

      resolve(canvas);
    });
  }

  global.html2canvas = html2canvas;
})(window);
