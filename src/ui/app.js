/** Контроллер калькулятора. */

import { calculateOffer, regulatoryCeiling, Verdict, round2 } from '../core/calc.js';
import { loadRegistry, findProfileCeilingGroup } from '../core/registry.js';
import { renderLineChart, renderLegend } from './chart.js';
import { money, moneyShort, moneyAxis, percent, date, VERIFICATION_TEXT } from './format.js';

const SERIES_COLORS = ['var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)'];

/**
 * Короткая подпись серии прямо у линии. Если все предложения от одного
 * провайдера, различает их тариф, иначе — имя провайдера.
 */
function seriesShortName(offer, allOffers) {
  const sameProvider = allOffers.every((o) => o.provider_short === allOffers[0].provider_short);
  return (sameProvider ? offer.plan || offer.product : offer.provider_short) || offer.provider_short;
}

const state = {
  registry: null,
  context: 'online',
  method: 'card',
  scheme: 'percent',
  amount: 1000,
  turnover: 2000000,
  terminals: 1,
  showVat: true,
  options: {},
};

const $ = (id) => document.getElementById(id);

/* ------------------------- состояние в адресе ------------------------- */
/* Параметры живут в строке запроса, чтобы конкретный расчёт можно было
   показать по ссылке — это нужно для демонстрации и для воспроизводимости. */

function readStateFromUrl() {
  const q = new URLSearchParams(location.search);
  const ctx = q.get('context');
  const mtd = q.get('method');
  const sch = q.get('scheme');
  if (ctx === 'online' || ctx === 'pos') state.context = ctx;
  if (mtd === 'card' || mtd === 'sbp') state.method = mtd;
  if (sch === 'percent' || sch === 'package') state.scheme = sch;
  const numParam = (k, min) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && v >= min ? v : null;
  };
  const a = numParam('amount', 1);
  const t = numParam('turnover', 0);
  const n = numParam('terminals', 1);
  if (a != null) state.amount = a;
  if (t != null) state.turnover = t;
  if (n != null) state.terminals = Math.round(n);
  if (q.get('vat') === '0') state.showVat = false;
  if (q.get('receipts') === '1') state.options = { 'yookassa-receipts': true };
}

function writeStateToUrl() {
  const q = new URLSearchParams({
    context: state.context,
    method: state.method,
    amount: String(state.amount),
    turnover: String(state.turnover),
  });
  if (state.context === 'pos') {
    q.set('terminals', String(state.terminals));
    q.set('scheme', state.scheme);
  }
  if (!state.showVat) q.set('vat', '0');
  if (state.options['yookassa-receipts']) q.set('receipts', '1');
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

/* ------------------------- вспомогательное ------------------------- */

function row(label, value) {
  const d = document.createElement('div');
  d.className = 'offer__row md-body-medium';
  const a = document.createElement('span');
  a.className = 'md-muted';
  a.textContent = label;
  const b = document.createElement('span');
  b.textContent = value;
  d.append(a, b);
  return d;
}

function sourceBlock(result) {
  const src = result.source || {};
  const wrap = document.createElement('details');
  wrap.className = 'offer__details';
  const sum = document.createElement('summary');
  sum.textContent = 'Источник и условия применения';
  wrap.appendChild(sum);

  const body = document.createElement('div');
  body.className = 'stack stack--tight';
  body.style.marginTop = '8px';

  const dl = document.createElement('dl');
  dl.className = 'kv';
  const add = (k, v, isLink) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    if (isLink && v) {
      const a = document.createElement('a');
      a.className = 'md-link';
      a.href = v;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = v;
      dd.appendChild(a);
    } else {
      dd.textContent = v || '—';
    }
    dl.append(dt, dd);
  };
  add('Документ', src.document);
  add('Ссылка', src.url, true);
  if (src.official_tariff_document) add('Тарифный документ', src.official_tariff_document, /^https?:/.test(src.official_tariff_document));
  if (src.snapshot_url) add('Проверенный снимок', src.snapshot_url, true);
  if (src.effective_from) add('Действует с', date(src.effective_from));
  if (src.effective_to) add('Действует по', date(src.effective_to));
  add('Дата обращения', date(src.accessed));
  add('Способ проверки', VERIFICATION_TEXT[src.verification] || src.verification);
  if (result.needsManualVerification) {
    add('Ручная сверка', 'требуется: ставку нужно подтвердить действующим тарифным документом');
  }
  if (result.outOfContextNote) add('Замечание о контексте', result.outOfContextNote);
  body.appendChild(dl);

  if (result.quotes?.length) {
    for (const q of result.quotes) {
      const bq = document.createElement('blockquote');
      bq.className = 'quote';
      bq.textContent = `«${q}»`;
      body.appendChild(bq);
    }
  }

  if (result.conditions?.length) {
    const h = document.createElement('p');
    h.className = 'md-title-small';
    h.style.margin = '4px 0 0';
    h.textContent = 'Условия применения';
    const ul = document.createElement('ul');
    ul.className = 'list-plain';
    for (const c of result.conditions) {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    }
    body.append(h, ul);
  }

  if (result.missingParameters?.length) {
    const h = document.createElement('p');
    h.className = 'md-title-small';
    h.style.margin = '4px 0 0';
    h.textContent = 'Чего не хватает в публичных данных';
    const ul = document.createElement('ul');
    ul.className = 'list-plain';
    for (const c of result.missingParameters) {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    }
    body.append(h, ul);
  }

  wrap.appendChild(body);
  return wrap;
}

/* ------------------------- карточки результатов ------------------------- */

function offerCard(result, color) {
  const card = document.createElement('article');
  card.className = 'md-card md-card--elevated offer';

  const head = document.createElement('div');
  head.className = 'offer__head';
  const titleWrap = document.createElement('div');
  titleWrap.style.display = 'flex';
  titleWrap.style.gap = '10px';
  if (color) {
    const sw = document.createElement('span');
    sw.className = 'offer__swatch';
    sw.style.background = color;
    titleWrap.appendChild(sw);
  }
  const t = document.createElement('div');
  t.className = 'offer__title';
  const n = document.createElement('p');
  n.className = 'md-title-medium';
  n.style.margin = '0';
  n.textContent = result.providerShort || result.provider;
  const p = document.createElement('p');
  p.className = 'md-body-small md-muted';
  p.style.margin = '0';
  p.textContent = [result.product, result.plan].filter(Boolean).join(' · ');
  t.append(n, p);
  titleWrap.appendChild(t);
  head.appendChild(titleWrap);
  card.appendChild(head);

  if (result.verdict !== Verdict.OK) {
    const banner = document.createElement('div');
    banner.className = 'md-banner ' + (result.verdict === Verdict.NOT_DETERMINABLE ? 'md-banner--error' : 'md-banner--warning');
    const inner = document.createElement('div');
    inner.className = 'stack stack--tight';
    const h = document.createElement('p');
    h.className = 'md-title-small';
    h.style.margin = '0';
    h.textContent =
      result.verdict === Verdict.NOT_DETERMINABLE ? 'Расчёт невозможен' : 'Ставка не применяется к этим параметрам';
    const why = document.createElement('p');
    why.className = 'md-body-medium';
    why.style.margin = '0';
    why.textContent = result.reason;
    const code = document.createElement('p');
    code.className = 'md-label-medium';
    code.style.margin = '0';
    code.textContent = `Причина: ${result.reasonLabel}`;
    inner.append(h, why, code);
    banner.appendChild(inner);
    card.appendChild(banner);
    card.appendChild(sourceBlock(result));
    return card;
  }

  const headline = document.createElement('div');
  headline.className = 'offer__headline';
  const big = document.createElement('p');
  big.className = 'md-display-small offer__amount';
  big.style.margin = '0';
  const monthly = state.showVat ? result.monthly.gross : result.monthly.net;
  big.textContent = moneyShort(monthly);
  const per = document.createElement('p');
  per.className = 'md-body-medium md-muted';
  per.style.margin = '0';
  // Для СБП НДС не начисляется, поэтому приписка «с НДС» была бы неверной.
  per.textContent = result.vat?.applies
    ? `за месяц ${state.showVat ? 'с НДС' : 'без НДС'}`
    : 'за месяц, НДС не начисляется';
  headline.append(big, per);
  card.appendChild(headline);

  const rows = document.createElement('div');
  rows.className = 'offer__rows';
  rows.appendChild(row('Ставка по документу', percent(result.ratePercent)));
  if (result.perPayment) {
    rows.appendChild(
      row(
        `Комиссия с платежа ${moneyShort(state.amount)}`,
        money(state.showVat ? result.perPayment.gross : result.perPayment.net),
      ),
    );
  } else {
    rows.appendChild(row('Комиссия с одного платежа', 'не определяется отдельно (пакетная плата)'));
  }
  rows.appendChild(row('Плата за месяц без НДС', money(result.monthly.net)));
  rows.appendChild(
    row(
      result.vat?.applies ? `НДС ${percent(result.vat.rate_percent)}` : 'НДС',
      result.vat?.applies ? money(result.monthly.vat) : 'не начисляется',
    ),
  );
  rows.appendChild(row('Итого за месяц', money(result.monthly.gross)));
  rows.appendChild(row('Эффективная ставка', percent(result.effectiveRatePercent)));
  card.appendChild(rows);

  if (result.breakdown?.length) {
    const d = document.createElement('details');
    d.className = 'offer__details';
    const s = document.createElement('summary');
    s.textContent = 'Как получилась сумма';
    d.appendChild(s);
    const ul = document.createElement('ul');
    ul.className = 'offer__breakdown md-body-medium';
    ul.style.marginTop = '8px';
    for (const b of result.breakdown) {
      const li = document.createElement('li');
      li.textContent = b.value == null ? b.label : `${b.label}: ${money(b.value)}`;
      ul.appendChild(li);
    }
    d.appendChild(ul);
    card.appendChild(d);
  }

  card.appendChild(sourceBlock(result));
  return card;
}

/* ------------------------- предел Банка России ------------------------- */

function renderCeiling() {
  const host = $('ceiling-section');
  host.replaceChildren();
  if (state.method !== 'sbp') return;

  const limits = state.registry.reference_limits.find((l) => l.id === 'cbr-sbp-c2b-limits');
  const group = findProfileCeilingGroup(state.registry);
  const c = regulatoryCeiling(group, state.amount);

  const h = document.createElement('h2');
  h.className = 'md-headline-small';
  h.id = 'ceiling-h';
  h.style.margin = '0';
  h.textContent = 'Справочно: предел, установленный Банком России';
  host.appendChild(h);

  const card = document.createElement('article');
  card.className = 'md-card md-card--outlined stack stack--tight';

  const warn = document.createElement('div');
  warn.className = 'md-banner md-banner--warning';
  const wi = document.createElement('div');
  wi.className = 'stack stack--tight';
  const wh = document.createElement('p');
  wh.className = 'md-title-small';
  wh.style.margin = '0';
  wh.textContent = 'Это не тариф банка';
  const wb = document.createElement('p');
  wb.className = 'md-body-medium';
  wb.style.margin = '0';
  wi.append(wh, wb);
  warn.appendChild(wi);
  card.appendChild(warn);

  const rows = document.createElement('div');
  rows.className = 'offer__rows';
  rows.appendChild(row('Применимая группа', `${group.group} — ${group.label}`));
  rows.appendChild(row('Предельная ставка', percent(group.rate_percent)));
  rows.appendChild(row('Предел за перевод', group.cap_rub == null ? 'не установлен' : money(group.cap_rub)));
  rows.appendChild(row(`Предел для платежа ${moneyShort(state.amount)}`, money(c.perPayment)));
  rows.appendChild(row('Ограничение сработало', c.capReached ? 'да' : 'нет'));
  rows.appendChild(row('Комиссия с плательщика-физлица', money(0)));
  card.appendChild(rows);

  const q = document.createElement('blockquote');
  q.className = 'quote';
  q.textContent = `«${group.quote}»`;
  card.appendChild(q);

  const dl = document.createElement('dl');
  dl.className = 'kv';
  const add = (k, v, link) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    if (link) {
      const a = document.createElement('a');
      a.className = 'md-link';
      a.href = v;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = v;
      dd.appendChild(a);
    } else dd.textContent = v;
    dl.append(dt, dd);
  };
  add('Документ', limits.document);
  add('Ссылка', limits.url, true);
  add('Действует с', date(limits.effective_from));
  add('Дата обращения', date(limits.accessed));
  card.appendChild(dl);

  host.appendChild(card);
}

/* ------------------------- графики ------------------------- */

/**
 * Предложения, попадающие в текущую выборку.
 *
 * Для торговой точки дополнительно фильтруем по схеме тарифа: процентная и
 * пакетная схемы — это альтернативы, а не слагаемые. Заодно это удерживает
 * число серий на графике в пределах трёх цветов палитры: цвета категорий
 * назначаются в фиксированном порядке и не идут по кругу.
 */
function offersInScope(status = null) {
  return state.registry.offers.filter((o) => {
    if (o.context !== state.context || o.method !== state.method) return false;
    if (status && o.status !== status) return false;
    if (state.context === 'pos' && o.pricing) {
      const isPackage = o.pricing.model === 'package';
      if (state.scheme === 'package' && !isPackage) return false;
      if (state.scheme === 'percent' && isPackage) return false;
    }
    return true;
  });
}

function computableFor() {
  const list = offersInScope('computable');
  // Страховка: палитра валидирована на три цвета, больше серий не рисуем.
  return list.slice(0, SERIES_COLORS.length);
}

function buildTurnoverSeries() {
  const offers = computableFor();
  // Область построения подбирается под контекст, иначе интересный участок
  // сжимается в край графика: онлайн — чтобы были видны оба порога (2 и 5 млн ₽),
  // торговая точка — чтобы читалась зона действия минимального платежа.
  const { from: xStart, to: maxX } =
    state.context === 'online'
      ? { from: 100_000, to: Math.max(state.turnover * 1.6, 6_000_000) }
      : { from: 20_000, to: Math.max(state.turnover * 2.5, 400_000) };
  const steps = 90;
  const series = [];
  const annotations = [];

  offers.forEach((offer, i) => {
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const x = xStart + ((maxX - xStart) / steps) * k;
      if (x <= 0) continue;
      const r = calculateOffer(offer, {
        amount: state.amount,
        monthlyTurnover: x,
        terminals: state.terminals,
        options: state.options,
      });
      // Разрыв линии там, где опубликованная ставка не применяется, — честнее,
      // чем продолжать её за пределами условий.
      if (r.verdict === Verdict.OK && r.effectiveRatePercent != null) {
        pts.push({ x, y: state.showVat ? r.effectiveRatePercent : r.effectiveRateNetPercent });
      }
    }
    const thrMin = offer.applicability?.min_monthly_turnover_rub;
    const thrMax = offer.applicability?.max_monthly_turnover_rub;
    if (thrMin) annotations.push({ x: thrMin, label: `порог ${moneyAxis(thrMin)} ₽` });
    if (thrMax) annotations.push({ x: thrMax, label: `предел ${moneyAxis(thrMax)} ₽` });

    if (pts.length > 1) {
      series.push({
        id: offer.id,
        name: `${offer.provider_short} — ${offer.plan || offer.product}`,
        shortName: seriesShortName(offer, offers),
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points: pts,
      });
    }
  });

  return { series, annotations };
}

function buildAmountSeries() {
  const offers = computableFor();
  const maxX = Math.max(state.amount * 3, 300_000);
  const steps = 90;
  const series = [];

  offers.forEach((offer, i) => {
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const x = (maxX / steps) * k;
      if (x <= 0) continue;
      const r = calculateOffer(offer, {
        amount: x,
        monthlyTurnover: state.turnover,
        terminals: state.terminals,
        options: state.options,
      });
      if (r.verdict === Verdict.OK && r.perPayment) {
        pts.push({ x, y: state.showVat ? r.perPayment.gross : r.perPayment.net });
      }
    }
    if (pts.length > 1) {
      series.push({
        id: offer.id,
        name: `${offer.provider_short} — ${offer.plan || offer.product}`,
        shortName: seriesShortName(offer, offers),
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points: pts,
      });
    }
  });

  // Предел Банка России — пунктир нейтральным цветом, не ещё одна серия.
  const group = findProfileCeilingGroup(state.registry);
  const ceil = [];
  for (let k = 1; k <= steps; k++) {
    const x = (maxX / steps) * k;
    ceil.push({ x, y: regulatoryCeiling(group, x).perPayment });
  }
  series.push({
    id: 'cbr-ceiling',
    name: 'Предел Банка России для СБП (группа 3)',
    shortName: 'предел ЦБ',
    color: 'var(--viz-reference)',
    dashed: true,
    points: ceil,
  });

  return { series };
}

function fillTable(table, series, xLabel, xFormat, yFormat, sampleCount = 8) {
  table.replaceChildren();
  if (!series.length) return;
  const xs = series[0].points.map((p) => p.x);
  const picks = [];
  for (let i = 0; i < sampleCount; i++) {
    picks.push(xs[Math.round(((xs.length - 1) * i) / (sampleCount - 1))]);
  }

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.textContent = xLabel;
  htr.appendChild(th0);
  for (const s of series) {
    const th = document.createElement('th');
    th.className = 'num';
    th.textContent = s.name;
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const tbody = document.createElement('tbody');
  for (const x of picks) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.className = 'num';
    td0.textContent = xFormat(x);
    tr.appendChild(td0);
    for (const s of series) {
      const p = s.points.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a), s.points[0]);
      const td = document.createElement('td');
      td.className = 'num';
      td.textContent = yFormat(p.y);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
}

function renderCharts() {
  const vatSuffix = state.showVat ? 'с НДС' : 'без НДС';

  const t = buildTurnoverSeries();
  $('chart1-sub').textContent = `Эффективная ставка ${vatSuffix}: вся плата за месяц, поделённая на оборот. Разрыв линии означает, что опубликованная ставка к такому обороту не применяется.`;
  renderLineChart($('chart1'), {
    series: t.series,
    annotations: t.annotations,
    xLabel: 'Оборот за месяц, ₽',
    yLabel: `Эффективная ставка, % (${vatSuffix})`,
    xFormat: (v) => `${moneyAxis(v)}`,
    tooltipXFormat: (v) => `Оборот ${moneyShort(v)}`,
    yFormat: (v) => percent(round2(v)),
  });
  renderLegend($('chart1-legend'), t.series);
  fillTable($('chart1-table'), t.series, 'Оборот, ₽', (v) => moneyShort(v), (v) => percent(round2(v)));

  const a = buildAmountSeries();
  $('chart2-sub').textContent = `Комиссия за один платёж ${vatSuffix} при обороте ${moneyShort(state.turnover)}. Пунктир — предельное значение Банка России для СБП: ориентир регулятора, а не ставка банка; на ${money(1500)} виден установленный предел за перевод.`;
  renderLineChart($('chart2'), {
    series: a.series,
    xLabel: 'Сумма одного платежа, ₽',
    yLabel: `Комиссия за платёж, ₽ (${vatSuffix})`,
    xFormat: (v) => `${moneyAxis(v)}`,
    tooltipXFormat: (v) => `Платёж ${moneyShort(v)}`,
    yFormat: (v) => money(round2(v)),
  });
  renderLegend($('chart2-legend'), a.series);
  fillTable($('chart2-table'), a.series, 'Платёж, ₽', (v) => moneyShort(v), (v) => money(round2(v)));
}

/* ------------------------- основной рендер ------------------------- */

function render() {
  const reg = state.registry;

  $('terminals-field').hidden = state.context !== 'pos';
  $('scheme-wrap').hidden = !(state.context === 'pos' && state.method === 'card');
  $('receipts-wrap').hidden = !(state.context === 'online' && state.method === 'card');

  const params = {
    amount: state.amount,
    monthlyTurnover: state.turnover,
    terminals: state.terminals,
    options: state.options,
  };

  const inScope = offersInScope();
  const computable = inScope.filter((o) => o.status === 'computable');
  const excluded = inScope.filter((o) => o.status === 'excluded');

  const results = $('results');
  results.replaceChildren();
  if (computable.length === 0) {
    const banner = document.createElement('div');
    banner.className = 'md-banner md-banner--error';
    const inner = document.createElement('div');
    inner.className = 'stack stack--tight';
    const h = document.createElement('p');
    h.className = 'md-title-small';
    h.style.margin = '0';
    h.textContent = 'Ни одно предложение нельзя рассчитать';
    const b = document.createElement('p');
    b.className = 'md-body-medium';
    b.style.margin = '0';
    b.textContent =
      state.method === 'sbp'
        ? 'Ни один из изученных банков и провайдеров не публикует однозначную ставку СБП для выбранного профиля: условия заявлены как «от …» или «рассчитываются индивидуально». Публично доступен только предел Банка России, приведённый ниже справочно.'
        : 'Для выбранного контекста в реестре нет предложений с однозначно определимыми условиями.';
    inner.append(h, b);
    banner.appendChild(inner);
    results.appendChild(banner);
  } else {
    computable.forEach((o, i) => {
      results.appendChild(offerCard(calculateOffer(o, params), SERIES_COLORS[i % SERIES_COLORS.length]));
    });
  }

  const ex = $('excluded');
  ex.replaceChildren();
  for (const o of excluded) ex.appendChild(offerCard(calculateOffer(o, params), null));

  renderCeiling();
  renderCharts();
  writeStateToUrl();
}

/* ------------------------- события ------------------------- */

function bindSegmented(id, onPick) {
  const group = $(id);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.md-segmented__item');
    if (!btn) return;
    for (const b of group.querySelectorAll('.md-segmented__item')) {
      b.setAttribute('aria-checked', String(b === btn));
    }
    onPick(btn.dataset.value);
  });
}

function num(el, fallback, min = 0) {
  const v = Number(el.value);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

async function main() {
  try {
    state.registry = await loadRegistry('./tariffs.json');
  } catch (err) {
    document.querySelector('main').innerHTML =
      `<div class="md-banner md-banner--error"><div><p class="md-title-small" style="margin:0">Не удалось загрузить реестр тарифов</p><p class="md-body-medium" style="margin:0">${err.message}</p></div></div>`;
    return;
  }

  readStateFromUrl();
  // Приводим элементы управления в соответствие с состоянием из адреса.
  $('amount').value = state.amount;
  $('turnover').value = state.turnover;
  $('terminals').value = state.terminals;
  $('vat-toggle').checked = state.showVat;
  $('yk-receipts').checked = Boolean(state.options['yookassa-receipts']);
  for (const [groupId, val] of [['ctx-group', state.context], ['method-group', state.method], ['scheme-group', state.scheme]]) {
    for (const b of $(groupId).querySelectorAll('.md-segmented__item')) {
      b.setAttribute('aria-checked', String(b.dataset.value === val));
    }
  }

  bindSegmented('ctx-group', (v) => {
    state.context = v;
    // Для торговой точки по умолчанию оборот меньше — иначе график неинформативен.
    if (v === 'pos' && state.turnover === 2000000) {
      state.turnover = 300000;
      $('turnover').value = 300000;
    }
    render();
  });
  bindSegmented('method-group', (v) => {
    state.method = v;
    render();
  });
  bindSegmented('scheme-group', (v) => {
    state.scheme = v;
    render();
  });

  $('amount').addEventListener('input', (e) => {
    state.amount = num(e.target, 1000, 1);
    render();
  });
  $('turnover').addEventListener('input', (e) => {
    state.turnover = num(e.target, 0, 0);
    render();
  });
  $('terminals').addEventListener('input', (e) => {
    state.terminals = Math.max(1, Math.round(num(e.target, 1, 1)));
    render();
  });
  $('vat-toggle').addEventListener('change', (e) => {
    state.showVat = e.target.checked;
    render();
  });
  $('yk-receipts').addEventListener('change', (e) => {
    state.options = { ...state.options, 'yookassa-receipts': e.target.checked };
    render();
  });

  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(renderCharts, 150);
  });

  render();
}

main();
