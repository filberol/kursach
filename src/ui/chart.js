/**
 * Линейные графики на инлайн-SVG. Без библиотек.
 *
 * Оформление следует правилам: тонкие линии 2px, приглушённая сетка, легенда
 * при двух и более сериях, прямые подписи серий, кроссхэйр с подсказкой,
 * текст — текстовыми токенами, а не цветом серии. Предел Банка России рисуется
 * пунктиром нейтральным цветом: это граница регулятора, а не ещё одна серия.
 */

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  return node;
}

function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/**
 * @param {HTMLElement} host контейнер (.viz__plot)
 * @param {object} spec  { series, xLabel, yLabel, xFormat, yFormat, annotations, yFromZero }
 */
export function renderLineChart(host, spec) {
  const {
    series = [],
    xLabel = '',
    yLabel = '',
    xFormat = (v) => String(v),
    yFormat = (v) => String(v),
    tooltipXFormat = xFormat,
    annotations = [],
    yFromZero = true,
  } = spec;

  host.replaceChildren();
  const drawn = series.filter((s) => s.points && s.points.length > 1);
  if (drawn.length === 0) {
    const note = document.createElement('p');
    note.className = 'md-body-medium md-muted';
    note.style.padding = '24px 8px';
    note.textContent = 'Нет данных для построения графика при текущих параметрах.';
    host.appendChild(note);
    return;
  }

  // --- геометрия ---
  const width = Math.max(320, host.clientWidth || 640);
  const height = Math.max(240, Math.min(380, Math.round(width * 0.52)));
  // Правое поле подбираем под самую длинную прямую подпись, иначе она
  // вылезает за пределы области построения (≈6,2px на символ при 11px шрифта).
  const longestLabel = drawn.reduce(
    (n, s) => Math.max(n, (s.shortName || s.name || '').length),
    0,
  );
  const rightPad = Math.min(170, Math.max(72, Math.round(longestLabel * 6.2) + 18));

  const xs = drawn.flatMap((s) => s.points.map((p) => p.x));
  const ys = drawn.flatMap((s) => s.points.map((p) => p.y));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMinRaw = Math.min(...ys);
  const yMaxRaw = Math.max(...ys);
  const yMin = yFromZero ? 0 : yMinRaw - (yMaxRaw - yMinRaw) * 0.1;
  const yMax = yMaxRaw + (yMaxRaw - yMin) * 0.12 || 1;

  // Левое поле считаем по самой широкой подписи оси Y плюс место под её
  // заголовок, иначе «10 000,00 ₽» наезжает на название оси.
  const yTicksPre = niceTicks(yMin, yMax, 5);
  const widestTick = yTicksPre.reduce((n, t) => Math.max(n, yFormat(t).length), 0);
  const leftPad = Math.min(140, Math.max(56, Math.round(widestTick * 6.2) + 34));

  const m = { top: 18, right: rightPad, bottom: 46, left: leftPad };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const sx = (v) => (xMax === xMin ? 0 : ((v - xMin) / (xMax - xMin)) * iw);
  const sy = (v) => ih - (yMax === yMin ? 0 : ((v - yMin) / (yMax - yMin)) * ih);

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `${yLabel} в зависимости от ${xLabel}`,
  });
  const plot = el('g', { transform: `translate(${m.left},${m.top})` });

  // --- сетка и оси (приглушённые) ---
  const yTicks = yTicksPre;
  for (const t of yTicks) {
    plot.appendChild(
      el('line', { x1: 0, y1: sy(t), x2: iw, y2: sy(t), stroke: 'var(--viz-grid)', 'stroke-width': 1 }),
    );
    const lab = el('text', { x: -10, y: sy(t) + 4, 'text-anchor': 'end', class: 'viz-axis-label' });
    lab.textContent = yFormat(t);
    plot.appendChild(lab);
  }

  const xTicks = niceTicks(xMin, xMax, Math.max(3, Math.floor(iw / 110)));
  for (const t of xTicks) {
    if (t < xMin || t > xMax) continue;
    const lab = el('text', { x: sx(t), y: ih + 20, 'text-anchor': 'middle', class: 'viz-axis-label' });
    lab.textContent = xFormat(t);
    plot.appendChild(lab);
  }

  plot.appendChild(
    el('line', { x1: 0, y1: ih, x2: iw, y2: ih, stroke: 'var(--md-outline-variant)', 'stroke-width': 1 }),
  );

  // подписи осей
  const xAx = el('text', { x: iw / 2, y: ih + 40, 'text-anchor': 'middle', class: 'viz-axis-label' });
  xAx.textContent = xLabel;
  plot.appendChild(xAx);
  const yAx = el('text', {
    transform: `rotate(-90) translate(${-ih / 2},${-(m.left - 14)})`,
    'text-anchor': 'middle',
    class: 'viz-axis-label',
  });
  yAx.textContent = yLabel;
  plot.appendChild(yAx);

  // --- аннотации порогов (вертикальные пунктиры) ---
  for (const a of annotations) {
    if (a.x < xMin || a.x > xMax) continue;
    plot.appendChild(
      el('line', {
        x1: sx(a.x), y1: 0, x2: sx(a.x), y2: ih,
        stroke: 'var(--viz-reference)', 'stroke-width': 1, 'stroke-dasharray': '3 4',
      }),
    );
    const t = el('text', { x: sx(a.x) + 4, y: 11, class: 'viz-annotation' });
    t.textContent = a.label;
    plot.appendChild(t);
  }

  // --- линии серий ---
  for (const s of drawn) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ');
    plot.appendChild(
      el('path', {
        d,
        fill: 'none',
        stroke: s.color,
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-dasharray': s.dashed ? '6 5' : null,
      }),
    );
  }

  // Прямые подписи серий у правого края (не число на каждой точке).
  // Близкие линии дали бы наложение подписей, поэтому разводим их по вертикали.
  const LABEL_GAP = 13;
  const labels = drawn
    .map((s) => {
      const last = s.points[s.points.length - 1];
      return { text: s.shortName || s.name, y: sy(last.y), x: sx(last.x) + 8 };
    })
    .sort((a, b) => a.y - b.y);

  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < LABEL_GAP) labels[i].y = labels[i - 1].y + LABEL_GAP;
  }
  // Если упёрлись в нижний край, сдвигаем всю стопку вверх.
  const overflow = labels.length ? labels[labels.length - 1].y - ih : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;

  for (const l of labels) {
    const lab = el('text', { x: l.x, y: Math.max(10, l.y) + 4, class: 'viz-series-label' });
    lab.textContent = l.text;
    plot.appendChild(lab);
  }

  // --- слой наведения: кроссхэйр + подсказка ---
  const crosshair = el('line', {
    x1: 0, y1: 0, x2: 0, y2: ih,
    stroke: 'var(--viz-reference)', 'stroke-width': 1, opacity: 0,
  });
  plot.appendChild(crosshair);

  const dots = drawn.map((s) => {
    const g = el('g', { opacity: 0 });
    // Кольцо цвета поверхности на перекрывающихся точках.
    g.appendChild(el('circle', { r: 6, fill: s.color, stroke: 'var(--viz-surface)', 'stroke-width': 2 }));
    plot.appendChild(g);
    return g;
  });

  const tooltip = document.createElement('div');
  tooltip.className = 'viz__tooltip';
  tooltip.setAttribute('role', 'status');
  host.appendChild(tooltip);

  const hit = el('rect', { x: 0, y: 0, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' });
  plot.appendChild(hit);

  function nearest(sr, xv) {
    let best = sr.points[0];
    let bd = Infinity;
    for (const p of sr.points) {
      const d = Math.abs(p.x - xv);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function hide() {
    crosshair.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    tooltip.dataset.visible = 'false';
  }

  function move(evt) {
    const rect = hit.getBoundingClientRect();
    const px = Math.max(0, Math.min(iw, evt.clientX - rect.left));
    const xv = xMin + (px / (iw || 1)) * (xMax - xMin);

    crosshair.setAttribute('opacity', 0.5);
    crosshair.setAttribute('x1', px);
    crosshair.setAttribute('x2', px);

    const rows = [];
    drawn.forEach((s, i) => {
      const p = nearest(s, xv);
      dots[i].setAttribute('opacity', 1);
      dots[i].setAttribute('transform', `translate(${sx(p.x)},${sy(p.y)})`);
      rows.push({ name: s.name, color: s.color, dashed: s.dashed, value: p.y });
    });

    tooltip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'viz__tooltip-title';
    title.textContent = tooltipXFormat(xv);
    tooltip.appendChild(title);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'viz__tooltip-row';
      const left = document.createElement('span');
      left.style.display = 'inline-flex';
      left.style.alignItems = 'center';
      left.style.gap = '8px';
      const mark = document.createElement('span');
      mark.className = 'viz__tooltip-mark';
      mark.style.background = r.color;
      if (r.dashed) { mark.style.color = r.color; mark.classList.add('viz__legend-mark--dashed'); }
      left.append(mark, document.createTextNode(r.name));
      const right = document.createElement('span');
      right.textContent = yFormat(r.value);
      row.append(left, right);
      tooltip.appendChild(row);
    }

    tooltip.dataset.visible = 'true';
    const tw = tooltip.offsetWidth || 200;
    const hostW = host.clientWidth;
    let left = m.left + px + 16;
    if (left + tw > hostW - 8) left = m.left + px - tw - 16;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${m.top + 8}px`;
  }

  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', hide);

  svg.appendChild(plot);
  host.appendChild(svg);
}

/** Легенда. Присутствует всегда при двух и более сериях. */
export function renderLegend(host, series) {
  host.replaceChildren();
  if (series.length < 2) return;
  for (const s of series) {
    const item = document.createElement('span');
    item.className = 'viz__legend-item';
    const mark = document.createElement('span');
    mark.className = 'viz__legend-mark' + (s.dashed ? ' viz__legend-mark--dashed' : '');
    mark.style.background = s.color;
    if (s.dashed) mark.style.color = s.color;
    item.append(mark, document.createTextNode(s.name));
    host.appendChild(item);
  }
}
