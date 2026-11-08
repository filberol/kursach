/**
 * Генерация docs/registry.md из data/tariffs.json.
 *
 * Реестр источников пишется не руками: иначе таблица в отчёте и данные, по
 * которым считает сервис, неизбежно разойдутся. Единственный источник истины —
 * data/tariffs.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from '../src/core/registry.js';
import { EXCLUSION_LABELS } from '../src/core/calc.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reg = validateRegistry(JSON.parse(await readFile(join(root, 'data', 'tariffs.json'), 'utf8')));

const d = (iso) => (iso ? iso.split('-').reverse().join('.') : '—');
const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')} %`);
const rub = (v) => (v == null ? '—' : `${v.toLocaleString('ru-RU')} ₽`);
const ctx = (c) => (c === 'online' ? 'на сайте' : 'торговая точка');
const mtd = (m) => (m === 'card' ? 'карты' : 'СБП');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function pricing(o) {
  const p = o.pricing;
  if (!p) return '—';
  switch (p.model) {
    case 'percent': {
      const add = (p.optional_components || []).map((c) => `+ ${pct(c.rate_percent)} (${c.label}, опционально)`).join(' ');
      return `${pct(p.rate_percent)} от суммы платежа ${add}`.trim();
    }
    case 'percent_with_min':
      return `${pct(p.rate_percent)} от оборота; минимальный платёж ${rub(p.min_monthly_fee_rub)}${p.min_fee_scope === 'per_terminal' ? ' за терминал' : ''}`;
    case 'package':
      return `пакет ${rub(p.package_size_rub)} за ${rub(p.package_price_rub)}${p.package_scope === 'per_terminal' ? ' на терминал' : ''}`;
    case 'percent_tiered':
      return p.tiers.map((t) => `${pct(t.rate_percent)} — ${t.label}`).join('; ');
    case 'percent_by_category':
      return p.categories.map((c) => `${pct(c.rate_percent)} — ${c.label}`).join('; ');
    default:
      return p.model;
  }
}

const L = [];
L.push('# Реестр рассмотренных предложений');
L.push('');
L.push('> Файл сгенерирован из `data/tariffs.json` командой `npm run docs`. Не редактируйте его руками —');
L.push('> правьте реестр, иначе отчёт и расчёт разойдутся.');
L.push('');
L.push(`**Контекст сопоставления:** ${reg.meta.primary_context_label}.`);
L.push('');
L.push(`**Профиль продавца:** ${reg.meta.merchant_profile.activity}; MCC ${reg.meta.merchant_profile.mcc_assumed}; ${reg.meta.merchant_profile.legal_form}.`);
L.push('');
L.push(reg.meta.merchant_profile.note);
L.push('');
L.push(`**Реестр собран:** ${d(reg.meta.registry_compiled)}.`);
L.push('');

const providers = new Set(reg.offers.map((o) => o.provider));
const computable = reg.offers.filter((o) => o.status === 'computable');
const primary = reg.offers.filter((o) => o.in_primary_comparison);

L.push('## Итоги в цифрах');
L.push('');
L.push(`| Показатель | Значение |`);
L.push(`| --- | --- |`);
L.push(`| Изучено банков и провайдеров | ${providers.size} |`);
L.push(`| Записей в реестре | ${reg.offers.length} |`);
L.push(`| Условия определимы однозначно | ${computable.length} |`);
L.push(`| Отобрано для основного сопоставления | ${primary.length} |`);
L.push(`| Исключено из расчёта | ${reg.offers.length - computable.length} |`);
L.push('');

L.push('## Ограничение доступа к данным');
L.push('');
const lim = reg.meta.data_access_limitation;
L.push(`${lim.summary}`);
L.push('');
L.push(`**Следствие.** ${lim.consequence}`);
L.push('');
L.push(`**Обязательный ручной шаг.** ${lim.required_manual_step}`);
L.push('');

L.push('## Сводная таблица');
L.push('');
L.push('| Провайдер | Продукт / тариф | Способ | Контекст | Плата по документу | Статус | Обращение | Источник |');
L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const o of reg.offers) {
  const status =
    o.status === 'computable'
      ? o.in_primary_comparison
        ? 'в сопоставлении'
        : 'справочно (другой контекст)'
      : `исключено — ${EXCLUSION_LABELS[o.exclusion_reason] || o.exclusion_reason}`;
  const url = o.source.snapshot_url || o.source.url;
  L.push(
    `| ${esc(o.provider_short)} | ${esc(o.product)}${o.plan ? ` · ${esc(o.plan)}` : ''} | ${mtd(o.method)} | ${ctx(o.context)} | ${esc(o.status === 'computable' ? pricing(o) : '—')} | ${status} | ${d(o.source.accessed)} | [документ](${url}) |`,
  );
}
L.push('');

L.push('## Предельные значения Банка России (не тариф банка)');
L.push('');
const cl = reg.reference_limits.find((x) => x.id === 'cbr-sbp-c2b-limits');
L.push('');
L.push(`- **Документ:** ${cl.document}`);
L.push(`- **Ссылка:** ${cl.url}`);
L.push(`- **Действует с:** ${d(cl.effective_from)}; **дата обращения:** ${d(cl.accessed)}`);
L.push(`- **Комиссия с плательщика-физлица:** ${cl.payer_fee_quote}`);
L.push('');
L.push('| Группа | Состав | Предельная ставка | Предел за перевод | Формулировка документа |');
L.push('| --- | --- | --- | --- | --- |');
for (const g of cl.groups) {
  L.push(
    `| ${g.group}${g.applies_to_our_profile ? ' ← наш профиль' : ''} | ${esc(g.label)} | ${pct(g.rate_percent)} | ${g.cap_rub == null ? 'не установлен' : rub(g.cap_rub)} | «${esc(g.quote)}» |`,
  );
}
L.push('');
L.push(`**Замечание к сверке.** ${cl.manual_verification_note}`);
L.push('');

function section(title, list, intro) {
  if (!list.length) return;
  L.push(`## ${title}`);
  L.push('');
  if (intro) { L.push(intro); L.push(''); }
  for (const o of list) {
    L.push(`### ${o.provider_short} — ${o.product}${o.plan ? ` · ${o.plan}` : ''}`);
    L.push('');
    L.push(`- **Полное наименование:** ${o.provider}`);
    L.push(`- **Контекст / способ оплаты:** ${ctx(o.context)} / ${mtd(o.method)}`);
    if (o.status === 'computable') L.push(`- **Структура платы:** ${pricing(o)}`);
    L.push(`- **НДС:** ${o.vat?.applies ? `начисляется, ${pct(o.vat.rate_percent)} на комиссию` : 'не начисляется'}`);
    if (o.applicability?.min_monthly_turnover_rub) L.push(`- **Порог применения:** оборот от ${rub(o.applicability.min_monthly_turnover_rub)} в месяц`);
    if (o.applicability?.max_monthly_turnover_rub) L.push(`- **Верхняя граница публичного тарифа:** ${rub(o.applicability.max_monthly_turnover_rub)} в месяц`);
    L.push(`- **Документ:** ${o.source.document}`);
    L.push(`- **Ссылка:** ${o.source.url}`);
    if (o.source.official_tariff_document) L.push(`- **Тарифный документ:** ${o.source.official_tariff_document}`);
    if (o.source.snapshot_url) L.push(`- **Проверенный снимок:** ${o.source.snapshot_url} (снимок от ${d(o.source.snapshot_date)})`);
    if (o.source.effective_from) L.push(`- **Действует с:** ${d(o.source.effective_from)}`);
    if (o.source.effective_to) L.push(`- **Действует по:** ${d(o.source.effective_to)}`);
    L.push(`- **Дата обращения:** ${d(o.source.accessed)}`);
    L.push(`- **Способ проверки:** ${o.source.verification}`);
    if (o.status === 'excluded') {
      L.push(`- **Причина исключения:** ${EXCLUSION_LABELS[o.exclusion_reason] || o.exclusion_reason}`);
      L.push(`- **Пояснение:** ${o.exclusion_text}`);
    }
    if (o.out_of_context_note) L.push(`- **Замечание о контексте:** ${o.out_of_context_note}`);
    L.push('');
    if (o.quotes?.length) {
      L.push('**Дословные цитаты источника:**');
      L.push('');
      for (const q of o.quotes) L.push(`> «${q}»`);
      L.push('');
    }
    if (o.applicability?.notes?.length) {
      L.push('**Условия применения:**');
      L.push('');
      for (const n of o.applicability.notes) L.push(`- ${n}`);
      L.push('');
    }
    if (o.missing_parameters?.length) {
      L.push('**Параметры, которых не хватает для расчёта:**');
      L.push('');
      for (const n of o.missing_parameters) L.push(`- ${n}`);
      L.push('');
    }
  }
}

section('Предложения, отобранные для расчёта', primary,
  'Условия этих предложений определяются однозначно, и контекст у них общий — платежи на сайте.');
section('Расчётные, но вне основного контекста', reg.offers.filter((o) => o.status === 'computable' && !o.in_primary_comparison),
  'Плата определяется однозначно, но относится к приёму платежей в торговой точке. С онлайн-предложениями напрямую не сопоставляется; используется для проверки логики пакетов, минимальных платежей и НДС.');
section('Исключённые из расчёта', reg.offers.filter((o) => o.status === 'excluded'),
  'По этим предложениям расчёт не выполняется. Ни одна ставка не достраивалась предположениями.');

L.push('## НДС');
L.push('');
const v = reg.meta.vat_regime;
L.push(`- **Ставка:** ${pct(v.rate_percent)}; **применяется с:** ${d(v.applies_from)}; **база:** ${v.base}`);
L.push(`- **Операции по картам:** ${v.card_payments ? 'облагаются' : 'не облагаются'}`);
L.push(`- **Операции по СБП:** ${v.sbp_payments ? 'облагаются' : 'не облагаются'}`);
L.push('');
L.push(v.note);
L.push('');
for (const s of reg.vat_sources || []) {
  L.push(`### Подтверждение — ${s.provider}`);
  L.push('');
  L.push(`> «${s.quote}»`);
  L.push('');
  if (s.worked_example) {
    L.push('Числовой пример из источника:');
    L.push('');
    L.push(`> «${s.worked_example}»`);
    L.push('');
  }
  L.push(`Ссылка: ${s.url}${s.snapshot_url ? `; снимок: ${s.snapshot_url}` : ''}; дата обращения: ${d(s.accessed)}.`);
  L.push('');
}

L.push('## Ручная доверификация');
L.push('');
L.push('Перед сдачей работы каждую ставку ниже нужно открыть на живом сайте банка и сверить с действующим');
L.push('тарифным документом. Цифра, не подтверждённая действующим документом, не может предъявляться как');
L.push('действующий тариф.');
L.push('');
L.push('| Что сверить | Где | Что именно проверить |');
L.push('| --- | --- | --- |');
for (const o of reg.offers.filter((x) => x.needs_manual_verification)) {
  const what = o.status === 'computable'
    ? 'ставку, пороги, абонентскую плату и дату вступления в силу'
    : 'не появилось ли публичной числовой ставки';
  L.push(`| ${esc(o.provider_short)} — ${esc(o.product)}${o.plan ? ` · ${esc(o.plan)}` : ''} | ${o.source.url} | ${what} |`);
}
L.push(`| Банк России — состав групп СБП | ${cl.url} | отнесение розничного интернет-магазина к группе 3 по перечню MCC |`);
L.push('');

await writeFile(join(root, 'docs', 'registry.md'), L.join('\n'));
console.log(`docs/registry.md — строк: ${L.length}`);
