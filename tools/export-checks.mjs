/**
 * Выгрузка файла с исходными данными и проверкой расчётов вручную.
 *
 * Делает два файла в docs/:
 *   manual-check.csv  — случаи, ручная арифметика, ожидаемое и фактическое значения;
 *   tariff-data.csv   — плоская выгрузка реестра тарифов со ссылками на источники.
 *
 * CSV открывается в Excel/LibreOffice: разделитель «;», BOM для корректной кириллицы.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateOffer, regulatoryCeiling } from '../src/core/calc.js';
import { validateRegistry, findOffer, findCeilingGroup } from '../src/core/registry.js';
import { manualCases, ceilingCases } from '../tests/manual-cases.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const q = (v) => {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
const ru = (n) => (n == null ? '' : String(n).replace('.', ','));

const registry = validateRegistry(JSON.parse(await readFile(join(root, 'data', 'tariffs.json'), 'utf8')));

/* ---------- 1. Проверка расчётов вручную ---------- */

const checkRows = [[
  'Случай', 'Что проверяется', 'Предложение', 'Что покрывает',
  'Сумма платежа, ₽', 'Оборот за месяц, ₽', 'Терминалов',
  'Ручная арифметика',
  'Ожидаемый вердикт', 'Фактический вердикт',
  'Ожидаемая плата за месяц без НДС', 'Фактическая плата за месяц без НДС',
  'Ожидаемый НДС', 'Фактический НДС',
  'Ожидаемо итого', 'Фактически итого',
  'Ожидаемо с платежа итого', 'Фактически с платежа итого',
  'Совпадение', 'Опубликовано источником (сверка)',
  'Ссылка на источник', 'Дата обращения',
]];

let mismatches = 0;

for (const c of manualCases) {
  const offer = findOffer(registry, c.offerId);
  const got = calculateOffer(offer, c.params);
  const e = c.expect;

  const cmp = [];
  cmp.push(got.verdict === e.verdict);
  if (e.monthly) {
    cmp.push(got.monthly?.net === e.monthly.net);
    cmp.push(got.monthly?.vat === e.monthly.vat);
    cmp.push(got.monthly?.gross === e.monthly.gross);
  }
  if (e.perPayment) cmp.push(got.perPayment?.gross === e.perPayment.gross);
  if (e.reasonCode) cmp.push(got.reasonCode === e.reasonCode);
  const ok = cmp.every(Boolean);
  if (!ok) mismatches++;

  checkRows.push([
    c.id, c.title, `${offer.provider_short} — ${offer.product}${offer.plan ? ` · ${offer.plan}` : ''}`,
    (c.covers || []).join(', '),
    ru(c.params.amount), ru(c.params.monthlyTurnover), ru(c.params.terminals ?? 1),
    (c.hand || []).join(' | '),
    e.verdict, got.verdict,
    ru(e.monthly?.net), ru(got.monthly?.net),
    ru(e.monthly?.vat), ru(got.monthly?.vat),
    ru(e.monthly?.gross), ru(got.monthly?.gross),
    ru(e.perPayment?.gross), ru(got.perPayment?.gross),
    ok ? 'совпадает' : 'РАСХОЖДЕНИЕ',
    c.anchor || '',
    offer.source.snapshot_url || offer.source.url, offer.source.accessed,
  ]);
}

for (const c of ceilingCases) {
  const group = findCeilingGroup(registry, c.group);
  const got = regulatoryCeiling(group, c.amount);
  const ok = got.perPayment === c.expect.perPayment && got.capReached === c.expect.capReached;
  if (!ok) mismatches++;
  const limits = registry.reference_limits[0];
  checkRows.push([
    c.id, c.title, `Банк России — предел для СБП, группа ${c.group} (НЕ тариф банка)`,
    (c.covers || []).join(', '),
    ru(c.amount), '', '',
    (c.hand || []).join(' | '),
    'предел', got.capReached ? 'предел применён' : 'предел не применён',
    '', '', '', '',
    ru(c.expect.perPayment), ru(got.perPayment),
    '', '',
    ok ? 'совпадает' : 'РАСХОЖДЕНИЕ',
    group.quote,
    limits.url, limits.accessed,
  ]);
}

await writeFile(join(root, 'docs', 'manual-check.csv'), toCsv(checkRows));

/* ---------- 2. Плоская выгрузка реестра ---------- */

const dataRows = [[
  'ID', 'Провайдер', 'Короткое имя', 'Контекст', 'Способ оплаты', 'Продукт', 'Тариф',
  'Статус', 'В основном сопоставлении', 'Причина исключения',
  'Модель платы', 'Ставка, %', 'Абонентская плата, ₽', 'Мин. платёж, ₽', 'Размер пакета, ₽', 'Цена пакета, ₽',
  'НДС начисляется', 'Ставка НДС, %',
  'Порог: оборот от, ₽', 'Порог: оборот до, ₽',
  'Документ', 'Ссылка', 'Снимок', 'Дата снимка', 'Действует с', 'Дата обращения', 'Способ проверки',
  'Нужна ручная сверка', 'Не хватает параметров', 'Цитаты',
]];

for (const o of registry.offers) {
  const p = o.pricing || {};
  dataRows.push([
    o.id, o.provider, o.provider_short,
    o.context === 'online' ? 'на сайте' : 'торговая точка',
    o.method === 'card' ? 'карты' : 'СБП',
    o.product, o.plan || '',
    o.status === 'computable' ? 'расчётное' : 'исключено',
    o.in_primary_comparison ? 'да' : 'нет',
    o.exclusion_text || '',
    p.model || '', ru(p.rate_percent), ru(p.fixed_monthly_fee_rub), ru(p.min_monthly_fee_rub),
    ru(p.package_size_rub), ru(p.package_price_rub),
    o.vat?.applies ? 'да' : 'нет', ru(o.vat?.rate_percent),
    ru(o.applicability?.min_monthly_turnover_rub), ru(o.applicability?.max_monthly_turnover_rub),
    o.source.document, o.source.url, o.source.snapshot_url || '', o.source.snapshot_date || '',
    o.source.effective_from || '', o.source.accessed, o.source.verification,
    o.needs_manual_verification ? 'да' : 'нет',
    (o.missing_parameters || []).join(' | '),
    (o.quotes || []).join(' | '),
  ]);
}

const limits = registry.reference_limits[0];
for (const g of limits.groups) {
  dataRows.push([
    `cbr-group-${g.group}`, limits.authority, 'Банк России', 'предел регулятора', 'СБП',
    `${limits.title} — группа ${g.group}`, g.label,
    'справочный предел (НЕ тариф банка)', 'нет', '',
    'ceiling', ru(g.rate_percent), '', '', '', '',
    'нет', '', '', '',
    limits.document, limits.url, '', '', limits.effective_from, limits.accessed, limits.verification,
    limits.needs_manual_verification ? 'да' : 'нет',
    '', g.quote,
  ]);
}

await writeFile(join(root, 'docs', 'tariff-data.csv'), toCsv(dataRows));

console.log(`docs/manual-check.csv — случаев: ${manualCases.length + ceilingCases.length}, расхождений: ${mismatches}`);
console.log(`docs/tariff-data.csv  — строк: ${dataRows.length - 1}`);
if (mismatches > 0) {
  console.error('Есть расхождения между ручной проверкой и расчётом — разберитесь до сдачи работы.');
  process.exit(1);
}
