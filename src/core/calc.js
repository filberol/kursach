/**
 * Расчётное ядро сервиса сравнения открытых условий приёма платежей.
 *
 * Принципы, заложенные в модуль:
 *  1. Ядро не придумывает данные. Если в реестре нет однозначной ставки,
 *     результатом расчёта является отказ с указанием причины, а не число.
 *  2. Предельное значение Банка России не является тарифом банка и
 *     считается отдельно от предложений (см. regulatoryCeiling).
 *  3. НДС считается надбавкой к комиссии банка, а не частью ставки.
 *
 * Модуль не зависит от DOM и Node API — одинаково работает в браузере и в тестах.
 */

/** Итог применимости расчёта к предложению. */
export const Verdict = {
  /** Ставка однозначна и условия выполнены — расчёт выполнен. */
  OK: 'ok',
  /** Ставка однозначна, но заданные параметры вне условий её применения. */
  NOT_APPLICABLE: 'not_applicable',
  /** Публичных данных не хватает, чтобы определить ставку. Расчёт невозможен. */
  NOT_DETERMINABLE: 'not_determinable',
};

/** Человекочитаемые причины исключения предложения из расчёта. */
export const EXCLUSION_LABELS = {
  indeterminate_rate: 'Ставка не раскрыта числом / определяется индивидуально',
  open_ended_rate: 'Ставка опубликована в виде «от …»',
  individual_terms: 'Условия рассчитываются индивидуально',
  rate_not_on_verified_page: 'Ставка отсутствует на проверенном документе',
  no_verifiable_current_data: 'Нет проверяемых действующих данных',
  category_mismatch: 'Ставка привязана к другой категории деятельности',
};

/** Округление до копеек. Внутри расчёта точность не теряется — округляем только итог. */
export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Число пакетов по пакетной схеме.
 *
 * Семантика взята из опубликованного примера Т-Банка: на каждый терминал
 * покупается один пакет, лимиты терминалов суммируются, при превышении
 * суммарного лимита докупается ещё один пакет (и лимит растёт на его размер).
 *
 * @returns {number} количество оплаченных пакетов за месяц
 */
export function packagesNeeded(turnover, packageSize, terminals) {
  const base = Math.max(1, terminals);
  if (!(packageSize > 0)) return base;
  const includedLimit = packageSize * base;
  if (turnover <= includedLimit) return base;
  const excess = turnover - includedLimit;
  return base + Math.ceil(excess / packageSize);
}

/**
 * Ступень фиксированной месячной платы. Верхняя граница включающая:
 * «по 100 000 рублей (включительно)», «от 100 000,01 по 300 000 (включительно)».
 */
export function pickFeeTier(tiers, turnover) {
  for (const t of tiers || []) {
    if (turnover <= (t.max_monthly_turnover_rub ?? Infinity)) return t;
  }
  return null;
}

/** Выбор тарифной ступени по месячному обороту. */
export function pickTier(tiers, turnover) {
  const matches = (tiers || []).filter((t) => {
    const lo = t.min_monthly_turnover_rub ?? 0;
    const hi = t.max_monthly_turnover_rub ?? Infinity;
    return turnover >= lo && turnover < hi;
  });
  if (matches.length === 0) return null;
  // При пересечении диапазонов берём ступень с наибольшим порогом входа.
  return matches.sort(
    (a, b) => (b.min_monthly_turnover_rub ?? 0) - (a.min_monthly_turnover_rub ?? 0),
  )[0];
}

/**
 * Предельное значение комиссии СБП, установленное Банком России.
 * ВАЖНО: это верхняя граница регулятора, а не ставка какого-либо банка.
 */
export function regulatoryCeiling(group, amount) {
  if (!group) return null;
  const byRate = (amount * (group.rate_percent ?? 0)) / 100;
  const capped = group.cap_rub == null ? byRate : Math.min(byRate, group.cap_rub);
  return {
    perPayment: round2(capped),
    ratePercent: group.rate_percent,
    capRub: group.cap_rub,
    capReached: group.cap_rub != null && byRate > group.cap_rub,
    quote: group.quote,
  };
}

function vatOf(net, vat) {
  if (!vat || !vat.applies) return 0;
  return (net * (vat.rate_percent ?? 0)) / 100;
}

/**
 * Основной расчёт по одному предложению.
 *
 * @param {object} offer   запись реестра тарифов
 * @param {object} params  { amount, monthlyTurnover, paymentsPerMonth, terminals, options }
 * @returns {object} результат с вердиктом, суммами и ссылкой на источник
 */
export function calculateOffer(offer, params) {
  const {
    amount = 0,
    monthlyTurnover = 0,
    terminals = 1,
    options = {},
  } = params || {};

  const base = {
    offerId: offer.id,
    provider: offer.provider,
    providerShort: offer.provider_short,
    product: offer.product,
    plan: offer.plan,
    method: offer.method,
    context: offer.context,
    source: offer.source,
    quotes: offer.quotes || [],
    conditions: offer.applicability?.notes || [],
    outOfContextNote: offer.out_of_context_note || null,
    needsManualVerification: Boolean(offer.needs_manual_verification),
  };

  // 1. Предложение исключено на этапе сбора данных — расчёт невозможен.
  if (offer.status === 'excluded') {
    return {
      ...base,
      verdict: Verdict.NOT_DETERMINABLE,
      reasonCode: offer.exclusion_reason,
      reasonLabel: EXCLUSION_LABELS[offer.exclusion_reason] || 'Данных недостаточно',
      reason: offer.exclusion_text,
    };
  }

  const p = offer.pricing;
  if (!p) {
    return {
      ...base,
      verdict: Verdict.NOT_DETERMINABLE,
      reasonCode: 'no_pricing',
      reasonLabel: 'Нет описания тарифа',
      reason: 'В реестре отсутствует структура платы для этого предложения.',
    };
  }

  // 2. Проверка порогов применимости.
  const minT = offer.applicability?.min_monthly_turnover_rub ?? null;
  const maxT = offer.applicability?.max_monthly_turnover_rub ?? null;
  if (minT != null && monthlyTurnover < minT) {
    return {
      ...base,
      verdict: Verdict.NOT_APPLICABLE,
      reasonCode: 'below_min_turnover',
      reasonLabel: 'Оборот ниже порога применения ставки',
      reason:
        `Опубликованная ставка заявлена при обороте от ${minT.toLocaleString('ru-RU')} ₽ в месяц. ` +
        `Введённый оборот — ${monthlyTurnover.toLocaleString('ru-RU')} ₽. ` +
        `Ставка для меньших оборотов публично не раскрыта, поэтому расчёт не выполняется.`,
      threshold: { kind: 'min', value: minT },
    };
  }
  if (maxT != null && monthlyTurnover > maxT) {
    return {
      ...base,
      verdict: Verdict.NOT_APPLICABLE,
      reasonCode: 'above_max_turnover',
      reasonLabel: 'Оборот выше порога публичного тарифа',
      reason:
        `При обороте свыше ${maxT.toLocaleString('ru-RU')} ₽ в месяц условия, по заявлению провайдера, ` +
        `определяются индивидуально. Публичная ставка к такому обороту не применяется.`,
      threshold: { kind: 'max', value: maxT },
    };
  }

  // 3. Расчёт платы без НДС по модели тарифа.
  let netMonthly = 0;
  let netPerPayment = null;
  let ratePercent = null;
  let capApplied = false;
  let approximate = false;
  const breakdown = [];

  switch (p.model) {
    case 'percent':
    case 'percent_tiered': {
      if (p.model === 'percent_tiered') {
        const tier = pickTier(p.tiers, monthlyTurnover);
        if (!tier) {
          return {
            ...base,
            verdict: Verdict.NOT_DETERMINABLE,
            reasonCode: 'no_matching_tier',
            reasonLabel: 'Нет подходящей тарифной ступени',
            reason: 'Для введённого оборота в опубликованной тарифной сетке нет применимой ступени.',
          };
        }
        ratePercent = tier.rate_percent;
        breakdown.push({ label: `Ступень: ${tier.label}`, value: null });
      } else {
        ratePercent = p.rate_percent;
      }

      // Компоненты платы. Часть из них обязательна: опубликованная ставка
      // действует только вместе с ними, и при их отключении тариф неизвестен.
      let addon = 0;
      for (const c of p.components || []) {
        const enabled = options[c.id] ?? c.default_enabled;
        if (!enabled) {
          if (c.required) {
            return {
              ...base,
              verdict: Verdict.NOT_DETERMINABLE,
              reasonCode: 'component_required',
              reasonLabel: 'Ставка опубликована только вместе с обязательной услугой',
              reason: c.required_reason,
            };
          }
          continue;
        }
        addon += c.rate_percent || 0;
        breakdown.push({ label: `${c.label}: ${c.rate_percent}%`, value: null });
      }
      const effRate = ratePercent + addon;
      ratePercent = effRate;

      const uncapped = (amount * effRate) / 100;
      const cap = p.cap_rub ?? null;
      capApplied = cap != null && uncapped > cap;
      netPerPayment = cap == null ? uncapped : Math.min(uncapped, cap);

      if (cap == null) {
        netMonthly = (monthlyTurnover * effRate) / 100;
        breakdown.push({ label: `Комиссия ${effRate}% от оборота`, value: netMonthly });
      } else {
        // Ограничение задано на ОДНУ операцию, поэтому месячную плату нельзя
        // получить из оборота напрямую: нужно знать, из скольких платежей он
        // сложился. Считаем в явном допущении, что все платежи равны введённой
        // сумме. Это допущение об аргументах расчёта, а не статистика бизнеса,
        // и оно выводится пользователю.
        const rawPayments = amount > 0 ? monthlyTurnover / amount : 0;
        // Операция неделима, поэтому дробное число платежей недопустимо: берём
        // целое и помечаем результат оценкой, если оборот не делится нацело.
        const payments = Math.max(0, Math.round(rawPayments));
        approximate = Math.abs(rawPayments - payments) > 1e-9;
        netMonthly = payments * netPerPayment;
        breakdown.push({ label: `Комиссия ${effRate}% от суммы операции`, value: null });
        breakdown.push({
          label: `Ограничение ${cap.toLocaleString('ru-RU')} ₽ за операцию${capApplied ? ' — применено' : ' — не достигнуто'}`,
          value: null,
        });
        breakdown.push({ label: `Операций за месяц: ${payments}`, value: null });
        if (approximate) {
          breakdown.push({
            label: `Оценка: оборот не делится на сумму платежа нацело (${rawPayments.toFixed(3)})`,
            value: null,
          });
        }
        breakdown.push({ label: 'Плата за месяц', value: netMonthly });
      }
      break;
    }

    case 'percent_with_min': {
      ratePercent = p.rate_percent;
      netPerPayment = (amount * ratePercent) / 100;
      const byTurnover = (monthlyTurnover * ratePercent) / 100;
      const minFee =
        (p.min_monthly_fee_rub || 0) *
        (p.min_fee_scope === 'per_terminal' ? Math.max(1, terminals) : 1);
      netMonthly = Math.max(byTurnover, minFee);
      breakdown.push({ label: `Комиссия ${ratePercent}% от оборота`, value: byTurnover });
      if (minFee > 0) {
        breakdown.push({
          label: `Минимальный платёж${p.min_fee_scope === 'per_terminal' ? ` (${terminals} × ${p.min_monthly_fee_rub} ₽)` : ''}`,
          value: minFee,
        });
      }
      if (minFee > byTurnover) {
        breakdown.push({ label: 'Применён минимальный платёж', value: null });
      }
      break;
    }

    case 'tiered_fixed_plus_overage': {
      const tier = pickFeeTier(p.tiers, monthlyTurnover);
      if (!tier) {
        return {
          ...base,
          verdict: Verdict.NOT_DETERMINABLE,
          reasonCode: 'no_matching_tier',
          reasonLabel: 'Нет подходящей ступени платы',
          reason: 'Для введённого оборота в опубликованной тарифной сетке нет применимой ступени.',
        };
      }

      // Сверх порога тариф добавляет процент с каждой операции. Какая именно
      // операция считается совершённой «после превышения» и как при этом
      // разделяются карты и СБП, из опубликованного тарифа не следует,
      // поэтому выше порога сумма не рассчитывается.
      const ov = p.overage;
      if (ov && monthlyTurnover > ov.threshold_rub) {
        return {
          ...base,
          verdict: Verdict.NOT_DETERMINABLE,
          reasonCode: 'overage_not_determinable',
          reasonLabel: 'Сверх порога состав доплаты не определён',
          reason:
            `При превышении за месяц ${ov.threshold_rub.toLocaleString('ru-RU')} ₽ тариф добавляет ` +
            `${ov.rate_percent}% (минимум ${ov.min_per_operation_rub} ₽) с каждой операции — сверх фиксированной платы, ` +
            `а не вместо неё. Из опубликованного тарифа не следует, какие именно операции попадают под доплату: ` +
            `порог считается по общей сумме операций по картам и через СБП, а последовательность платежей и их ` +
            `распределение между способами оплаты не заданы. Поэтому сумма не рассчитывается.`,
          threshold: { kind: 'max', value: ov.threshold_rub },
        };
      }

      netMonthly = tier.fee_rub;
      netPerPayment = null; // плата месячная, к отдельному платежу не привязана
      breakdown.push({ label: `Ступень: ${tier.label}`, value: null });
      breakdown.push({ label: 'Фиксированная плата за месяц', value: netMonthly });
      break;
    }

    case 'package': {
      const n = packagesNeeded(monthlyTurnover, p.package_size_rub, terminals);
      netMonthly = n * p.package_price_rub;
      netPerPayment = null; // плата не привязана к отдельному платежу
      breakdown.push({
        label: `Пакетов за месяц: ${n} × ${p.package_price_rub.toLocaleString('ru-RU')} ₽ (размер пакета ${p.package_size_rub.toLocaleString('ru-RU')} ₽)`,
        value: netMonthly,
      });
      break;
    }

    case 'percent_by_category':
      return {
        ...base,
        verdict: Verdict.NOT_DETERMINABLE,
        reasonCode: 'category_required',
        reasonLabel: 'Ставка зависит от категории деятельности',
        reason:
          'Опубликованы разные ставки для отдельных категорий продавцов. ' +
          'Выбранный профиль ни в одну из них не попадает, а подставлять ставку другой категории нельзя.',
      };

    default:
      return {
        ...base,
        verdict: Verdict.NOT_DETERMINABLE,
        reasonCode: 'unknown_model',
        reasonLabel: 'Неизвестная модель тарификации',
        reason: `Модель «${p.model}» не поддерживается расчётным ядром.`,
      };
  }

  // 4. Фиксированная абонентская плата.
  const fixed = p.fixed_monthly_fee_rub || 0;
  if (fixed > 0) {
    netMonthly += fixed;
    breakdown.push({ label: 'Абонентская плата', value: fixed });
  }

  // 5. НДС — надбавка к комиссии банка.
  const vatMonthly = vatOf(netMonthly, offer.vat);
  const vatPerPayment = netPerPayment == null ? null : vatOf(netPerPayment, offer.vat);

  return {
    ...base,
    verdict: Verdict.OK,
    ratePercent,
    pricingModel: p.model,
    capRub: p.cap_rub ?? null,
    capApplied,
    approximate,
    breakdown,
    vat: offer.vat,
    perPayment:
      netPerPayment == null
        ? null
        : {
            net: round2(netPerPayment),
            vat: round2(vatPerPayment),
            gross: round2(netPerPayment + vatPerPayment),
          },
    monthly: {
      net: round2(netMonthly),
      vat: round2(vatMonthly),
      gross: round2(netMonthly + vatMonthly),
    },
    effectiveRatePercent:
      monthlyTurnover > 0
        ? round2(((netMonthly + vatMonthly) / monthlyTurnover) * 100)
        : null,
    effectiveRateNetPercent:
      monthlyTurnover > 0 ? round2((netMonthly / monthlyTurnover) * 100) : null,
  };
}

/** Расчёт по всем предложениям реестра с заданным фильтром. */
export function calculateAll(registry, params, filter = {}) {
  const { context = null, method = null, onlyPrimary = false } = filter;
  return registry.offers
    .filter((o) => (context ? o.context === context : true))
    .filter((o) => (method ? o.method === method : true))
    .filter((o) => (onlyPrimary ? o.in_primary_comparison : true))
    .map((o) => calculateOffer(o, params));
}
