/**
 * Загрузка и проверка реестра тарифов.
 * Реестр — единственный источник истины о ставках: ни одно число не зашито в код.
 */

/** Загрузка реестра в браузере. */
export async function loadRegistry(url = './tariffs.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Не удалось загрузить реестр тарифов: HTTP ${res.status}`);
  return validateRegistry(await res.json());
}

/** Поиск предложения по идентификатору. */
export function findOffer(registry, id) {
  const offer = registry.offers.find((o) => o.id === id);
  if (!offer) throw new Error(`Предложение не найдено в реестре: ${id}`);
  return offer;
}

/** Группа предельных значений Банка России по номеру. */
export function findCeilingGroup(registry, groupNumber) {
  const limits = registry.reference_limits?.find((l) => l.id === 'cbr-sbp-c2b-limits');
  if (!limits) throw new Error('В реестре нет предельных значений Банка России');
  const group = limits.groups.find((g) => g.group === groupNumber);
  if (!group) throw new Error(`Группа ${groupNumber} не найдена`);
  return group;
}

/**
 * Структурная проверка реестра. Ошибки реестра должны падать громко:
 * молчаливо посчитанный по битому тарифу результат хуже отсутствия результата.
 */
export function validateRegistry(reg) {
  const problems = [];
  if (!reg || typeof reg !== 'object') throw new Error('Реестр пуст или не является объектом');
  if (!Array.isArray(reg.offers)) throw new Error('В реестре отсутствует массив offers');

  const seen = new Set();
  for (const o of reg.offers) {
    const where = `offer «${o.id ?? '(без id)'}»`;
    if (!o.id) problems.push(`${where}: отсутствует id`);
    if (seen.has(o.id)) problems.push(`${where}: дублирующийся id`);
    seen.add(o.id);

    if (!o.provider) problems.push(`${where}: не указан провайдер`);
    if (!['online', 'pos'].includes(o.context)) problems.push(`${where}: недопустимый context`);
    if (!['card', 'sbp'].includes(o.method)) problems.push(`${where}: недопустимый method`);
    if (!['computable', 'excluded'].includes(o.status)) problems.push(`${where}: недопустимый status`);

    // Требование задания: у каждого предложения должен быть прослеживаемый источник.
    if (!o.source?.url) problems.push(`${where}: нет ссылки на источник`);
    if (!o.source?.accessed) problems.push(`${where}: нет даты обращения к источнику`);

    if (o.status === 'excluded') {
      if (!o.exclusion_reason) problems.push(`${where}: исключено без кода причины`);
      if (!o.exclusion_text) problems.push(`${where}: исключено без объяснения причины`);
    }

    if (o.status === 'computable') {
      if (!o.pricing) problems.push(`${where}: расчётное предложение без структуры платы`);
      if (!o.vat) problems.push(`${where}: не описан режим НДС`);
      if (o.pricing?.model === 'package') {
        if (!(o.pricing.package_size_rub > 0)) problems.push(`${where}: некорректный размер пакета`);
        if (!(o.pricing.package_price_rub > 0)) problems.push(`${where}: некорректная цена пакета`);
      }
      if (['percent', 'percent_with_min'].includes(o.pricing?.model)) {
        if (!(o.pricing.rate_percent > 0)) problems.push(`${where}: некорректная ставка`);
      }
    }
  }

  if (problems.length) {
    throw new Error('Реестр тарифов не прошёл проверку:\n - ' + problems.join('\n - '));
  }
  return reg;
}
