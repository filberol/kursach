/** Страница реестра источников. Рендерится из того же data/tariffs.json. */

import { loadRegistry } from '../core/registry.js';
import { EXCLUSION_LABELS } from '../core/calc.js';
import { date, percent, moneyShort, VERIFICATION_TEXT } from './format.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function link(url, label) {
  const a = el('a', 'md-link', label || url);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function kv(pairs) {
  const dl = el('dl', 'kv');
  for (const [k, v, isLink] of pairs) {
    if (v == null || v === '') continue;
    dl.appendChild(el('dt', null, k));
    const dd = el('dd');
    if (isLink) dd.appendChild(link(v));
    else dd.textContent = v;
    dl.appendChild(dd);
  }
  return dl;
}

function bullets(title, items) {
  const wrap = el('div', 'stack stack--tight');
  wrap.appendChild(el('p', 'md-title-small', title)).style.margin = '0';
  const ul = el('ul', 'list-plain');
  for (const i of items) ul.appendChild(el('li', null, i));
  wrap.appendChild(ul);
  return wrap;
}

/** Краткое описание структуры платы человеческим языком. */
function pricingSummary(o) {
  const p = o.pricing;
  if (!p) return '—';
  switch (p.model) {
    case 'percent':
      return `${percent(p.rate_percent)} от суммы платежа`;
    case 'percent_with_min':
      return `${percent(p.rate_percent)} от оборота, минимум ${moneyShort(p.min_monthly_fee_rub)}${p.min_fee_scope === 'per_terminal' ? ' за терминал' : ''}`;
    case 'package':
      return `пакет ${moneyShort(p.package_size_rub)} за ${moneyShort(p.package_price_rub)}`;
    case 'percent_tiered':
      return p.tiers.map((t) => `${percent(t.rate_percent)} (${t.label})`).join('; ');
    case 'percent_by_category':
      return p.categories.map((c) => `${percent(c.rate_percent)} — ${c.label}`).join('; ');
    default:
      return p.model;
  }
}

function offerCard(o) {
  const card = el('article', 'md-card md-card--outlined source-card');

  const head = el('div', 'source-card__head');
  const t = el('div');
  t.appendChild(el('p', 'md-title-medium', `${o.provider_short} — ${o.product}${o.plan ? ` · ${o.plan}` : ''}`)).style.margin = '0';
  t.appendChild(el('p', 'md-body-small md-muted', `${o.provider} · ${o.method === 'card' ? 'карты' : 'СБП'} · ${o.context === 'online' ? 'на сайте' : 'в торговой точке'}`)).style.margin = '0';
  head.appendChild(t);

  card.appendChild(head);

  if (o.status === 'excluded') {
    const b = el('div', 'md-banner md-banner--error');
    const inner = el('div', 'stack stack--tight');
    inner.appendChild(el('p', 'md-title-small', `Причина исключения: ${EXCLUSION_LABELS[o.exclusion_reason] || o.exclusion_reason}`)).style.margin = '0';
    inner.appendChild(el('p', 'md-body-medium', o.exclusion_text)).style.margin = '0';
    b.appendChild(inner);
    card.appendChild(b);
  } else {
    card.appendChild(kv([['Структура платы', pricingSummary(o)]]));
  }

  if (o.out_of_context_note) {
    card.appendChild(el('p', 'md-body-medium md-muted', o.out_of_context_note)).style.margin = '0';
  }

  const s = o.source || {};
  card.appendChild(
    kv([
      ['Документ', s.document],
      ['Ссылка', s.url, true],
      ['Тарифный документ', s.official_tariff_document, /^https?:/.test(s.official_tariff_document || '')],
      ['Проверенный снимок', s.snapshot_url, true],
      ['Дата снимка', s.snapshot_date ? date(s.snapshot_date) : null],
      ['Действует с', s.effective_from ? date(s.effective_from) : null],
      ['Действует по', s.effective_to ? date(s.effective_to) : null],
      ['Дата обращения', date(s.accessed)],
      ['Способ проверки', VERIFICATION_TEXT[s.verification] || s.verification],
      ['Ручная сверка', o.needs_manual_verification ? 'требуется' : 'не требуется'],
      ['НДС', o.vat?.applies ? `начисляется, ${percent(o.vat.rate_percent)}` : 'не начисляется'],
    ]),
  );

  if (o.quotes?.length) {
    const wrap = el('div', 'stack stack--tight');
    wrap.appendChild(el('p', 'md-title-small', 'Дословные цитаты источника')).style.margin = '0';
    for (const q of o.quotes) wrap.appendChild(el('blockquote', 'quote', `«${q}»`));
    card.appendChild(wrap);
  }

  if (o.applicability?.notes?.length) card.appendChild(bullets('Условия применения', o.applicability.notes));
  if (o.missing_parameters?.length) card.appendChild(bullets('Параметры, которых не хватает для расчёта', o.missing_parameters));

  return card;
}

function renderSummary(reg) {
  const table = $('summary-table');
  const cols = ['Провайдер', 'Продукт', 'Способ', 'Контекст', 'Плата по документу', 'Статус', 'Дата обращения', 'Источник'];
  const thead = el('thead');
  const htr = el('tr');
  for (const c of cols) htr.appendChild(el('th', null, c));
  thead.appendChild(htr);

  const tbody = el('tbody');
  for (const o of reg.offers) {
    const tr = el('tr');
    tr.appendChild(el('td', null, o.provider_short));
    tr.appendChild(el('td', null, `${o.product}${o.plan ? ` · ${o.plan}` : ''}`));
    tr.appendChild(el('td', null, o.method === 'card' ? 'карты' : 'СБП'));
    tr.appendChild(el('td', null, o.context === 'online' ? 'на сайте' : 'торговая точка'));
    tr.appendChild(el('td', null, o.status === 'computable' ? pricingSummary(o) : '—'));
    tr.appendChild(
      el(
        'td',
        null,
        o.status === 'computable'
          ? o.in_primary_comparison
            ? 'В сопоставлении'
            : 'Справочно'
          : `Исключено — ${EXCLUSION_LABELS[o.exclusion_reason] || o.exclusion_reason}`,
      ),
    );
    tr.appendChild(el('td', 'num', date(o.source.accessed)));
    const src = el('td');
    src.appendChild(link(o.source.snapshot_url || o.source.url, o.source.snapshot_url ? 'снимок' : 'страница'));
    tr.appendChild(src);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);

  const providers = new Set(reg.offers.map((o) => o.provider));
  const computable = reg.offers.filter((o) => o.status === 'computable');
  const primary = reg.offers.filter((o) => o.in_primary_comparison);
  $('summary-count').textContent =
    `Изучено провайдеров: ${providers.size}. Записей в реестре: ${reg.offers.length}. ` +
    `Определимых однозначно: ${computable.length}. В основном сопоставлении: ${primary.length}. ` +
    `Исключено: ${reg.offers.length - computable.length}.`;
}

function renderLimitation(reg) {
  const l = reg.meta.data_access_limitation;
  const host = $('limitation-body');
  const b = el('div', 'md-banner md-banner--warning');
  const inner = el('div', 'stack stack--tight');
  inner.appendChild(el('p', 'md-title-small', 'Почему часть данных взята из архивных снимков')).style.margin = '0';
  inner.appendChild(el('p', 'md-body-medium', l.summary)).style.margin = '0';
  inner.appendChild(el('p', 'md-body-medium', l.consequence)).style.margin = '0';
  inner.appendChild(el('p', 'md-body-medium', l.required_manual_step)).style.margin = '0';
  b.appendChild(inner);
  host.appendChild(b);
}

function renderCeiling(reg) {
  const host = $('ceiling-body');
  const l = reg.reference_limits.find((x) => x.id === 'cbr-sbp-c2b-limits');

  const warn = el('div', 'md-banner md-banner--warning');
  host.appendChild(warn);

  const card = el('article', 'md-card md-card--outlined source-card');
  card.appendChild(
    kv([
      ['Орган', l.authority],
      ['Документ', l.document],
      ['Ссылка', l.url, true],
      ['Действует с', date(l.effective_from)],
      ['Дата обращения', date(l.accessed)],
      ['Комиссия с плательщика', l.payer_fee_quote],
    ]),
  );

  const wrap = el('div', 'md-table-wrap');
  const table = el('table', 'md-table');
  const thead = el('thead');
  const htr = el('tr');
  for (const c of ['Группа', 'Состав', 'Предельная ставка', 'Предел за перевод', 'Формулировка']) htr.appendChild(el('th', null, c));
  thead.appendChild(htr);
  const tbody = el('tbody');
  for (const g of l.groups) {
    const tr = el('tr');
    tr.appendChild(el('td', 'num', String(g.group)));
    const lab = el('td');
    lab.appendChild(document.createTextNode(g.label));
    if (g.applies_to_our_profile) {
      lab.appendChild(document.createElement('br'));
      lab.appendChild(el('span', 'md-label-medium', '— применимо к нашему профилю'));
    }
    tr.appendChild(lab);
    tr.appendChild(el('td', 'num', percent(g.rate_percent)));
    tr.appendChild(el('td', 'num', g.cap_rub == null ? 'не установлен' : moneyShort(g.cap_rub)));
    tr.appendChild(el('td', null, `«${g.quote}»`));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  card.appendChild(wrap);

  if (l.manual_verification_note) {
    card.appendChild(el('div', 'md-banner md-banner--info md-body-small', l.manual_verification_note));
  }
  host.appendChild(card);
}

function renderVat(reg) {
  const host = $('vat-body');
  const v = reg.meta.vat_regime;
  const card = el('article', 'md-card md-card--outlined source-card');
  card.appendChild(
    kv([
      ['Ставка', percent(v.rate_percent)],
      ['Применяется с', date(v.applies_from)],
      ['База', v.base],
      ['Операции по картам', v.card_payments ? 'облагаются' : 'не облагаются'],
      ['Операции по СБП', v.sbp_payments ? 'облагаются' : 'не облагаются'],
      ['Пояснение', v.note],
    ]),
  );
  host.appendChild(card);

  for (const s of reg.vat_sources || []) {
    const c = el('article', 'md-card md-card--outlined source-card');
    c.appendChild(el('p', 'md-title-medium', s.provider)).style.margin = '0';
    c.appendChild(el('blockquote', 'quote', `«${s.quote}»`));
    if (s.worked_example) {
      c.appendChild(el('p', 'md-title-small', 'Числовой пример из источника')).style.margin = '0';
      c.appendChild(el('blockquote', 'quote', `«${s.worked_example}»`));
    }
    c.appendChild(kv([['Ссылка', s.url, true], ['Проверенный снимок', s.snapshot_url, true], ['Дата обращения', date(s.accessed)]]));
    host.appendChild(c);
  }
}

function renderTodo(reg) {
  const host = $('todo-body');
  const pending = reg.offers.filter((o) => o.needs_manual_verification);
  const card = el('article', 'md-card md-card--filled source-card');
  card.appendChild(
    el(
      'p',
      'md-body-medium',
      'Ставки ниже получены из архивных снимков или требуют сверки с живым тарифным документом. ' +
        'Это обязательный шаг перед сдачей работы: цифру, не подтверждённую действующим документом, нельзя предъявлять как действующий тариф.',
    ),
  ).style.margin = '0';
  const ul = el('ul', 'list-plain');
  for (const o of pending) {
    const li = el('li');
    li.appendChild(document.createTextNode(`${o.provider_short} — ${o.product}${o.plan ? ` · ${o.plan}` : ''}: `));
    li.appendChild(link(o.source.url, 'открыть живую страницу'));
    const extra = o.missing_parameters?.length ? ` · не хватает: ${o.missing_parameters.length} парам.` : '';
    li.appendChild(document.createTextNode(extra));
    ul.appendChild(li);
  }
  card.appendChild(ul);
  host.appendChild(card);
}

async function main() {
  let reg;
  try {
    reg = await loadRegistry('./tariffs.json');
  } catch (err) {
    document.querySelector('main').innerHTML =
      `<div class="md-banner md-banner--error"><p class="md-body-medium" style="margin:0">Не удалось загрузить реестр: ${err.message}</p></div>`;
    return;
  }

  renderLimitation(reg);
  renderCeiling(reg);
  renderSummary(reg);

  const included = reg.offers.filter((o) => o.in_primary_comparison);
  const reference = reg.offers.filter((o) => o.status === 'computable' && !o.in_primary_comparison);
  const excluded = reg.offers.filter((o) => o.status === 'excluded');

  for (const o of included) $('included-body').appendChild(offerCard(o));
  for (const o of reference) $('reference-body').appendChild(offerCard(o));
  for (const o of excluded) $('excluded-body').appendChild(offerCard(o));

  renderVat(reg);
  renderTodo(reg);
}

main();
