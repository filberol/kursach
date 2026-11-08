/**
 * Автоматическая сверка расчётного ядра с проверкой, выполненной вручную.
 *
 * Запуск: npm test
 *
 * Тест не изобретает ожидаемых значений: он берёт их из tests/manual-cases.js,
 * где каждая цифра выписана руками, а часть случаев опирается на числовые
 * примеры, опубликованные самими банками.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { calculateOffer, regulatoryCeiling, packagesNeeded, round2, Verdict } from '../src/core/calc.js';
import { validateRegistry, findOffer, findCeilingGroup } from '../src/core/registry.js';
import { manualCases, ceilingCases } from './manual-cases.js';

const here = dirname(fileURLToPath(import.meta.url));
const registry = validateRegistry(
  JSON.parse(readFileSync(join(here, '..', 'data', 'tariffs.json'), 'utf8')),
);

describe('Реестр тарифов', () => {
  test('проходит структурную проверку', () => {
    assert.ok(registry.offers.length > 0);
  });

  test('у каждого предложения есть источник и дата обращения', () => {
    for (const o of registry.offers) {
      assert.ok(o.source.url, `${o.id}: нет ссылки`);
      assert.ok(o.source.accessed, `${o.id}: нет даты обращения`);
    }
  });

  test('каждое исключённое предложение объясняет причину исключения', () => {
    const excluded = registry.offers.filter((o) => o.status === 'excluded');
    assert.ok(excluded.length > 0, 'реестр должен содержать исключённые предложения');
    for (const o of excluded) {
      assert.ok(o.exclusion_text.length > 20, `${o.id}: причина слишком короткая`);
    }
  });

  test('в основном сопоставлении не менее двух расчётных предложений', () => {
    const primary = registry.offers.filter((o) => o.in_primary_comparison);
    assert.ok(primary.length >= 2, `в сопоставлении только ${primary.length} предложений`);
    for (const o of primary) {
      assert.equal(o.status, 'computable');
      assert.equal(o.context, registry.meta.primary_context);
    }
  });

  test('изучено не менее трёх провайдеров', () => {
    const providers = new Set(registry.offers.map((o) => o.provider));
    assert.ok(providers.size >= 3, `провайдеров всего ${providers.size}`);
  });

  test('предел Банка России не записан как предложение банка', () => {
    for (const o of registry.offers) {
      assert.notEqual(o.provider, 'Банк России');
    }
    assert.ok(registry.reference_limits.some((l) => l.kind === 'regulatory_ceiling'));
  });

  test('НДС не начисляется на СБП ни в одном предложении', () => {
    for (const o of registry.offers.filter((x) => x.method === 'sbp')) {
      assert.equal(o.vat?.applies, false, `${o.id}: НДС на СБП не должен начисляться`);
    }
  });
});

describe('Вспомогательные функции', () => {
  test('round2 округляет до копеек', () => {
    assert.equal(round2(5.715), 5.72);
    assert.equal(round2(1990 * 0.22), 437.8);
  });

  test('packagesNeeded: один терминал, в пределах лимита', () => {
    assert.equal(packagesNeeded(50000, 100000, 1), 1);
  });

  test('packagesNeeded: граница лимита не докупает пакет', () => {
    assert.equal(packagesNeeded(100000, 100000, 1), 1);
  });

  test('packagesNeeded: превышение на 1 ₽ докупает пакет', () => {
    assert.equal(packagesNeeded(100001, 100000, 1), 2);
  });

  test('packagesNeeded: лимиты терминалов суммируются', () => {
    assert.equal(packagesNeeded(200000, 100000, 2), 2);
    assert.equal(packagesNeeded(200001, 100000, 2), 3);
  });
});

describe('Проверка расчётов вручную (предложения)', () => {
  for (const c of manualCases) {
    test(`${c.id} — ${c.title}`, () => {
      const offer = findOffer(registry, c.offerId);
      const got = calculateOffer(offer, c.params);

      assert.equal(got.verdict, c.expect.verdict, `вердикт: ожидали ${c.expect.verdict}, получили ${got.verdict}`);

      if (c.expect.reasonCode) {
        assert.equal(got.reasonCode, c.expect.reasonCode);
        assert.ok(got.reason && got.reason.length > 20, 'отказ должен содержать причину для пользователя');
      }

      if (c.expect.perPayment) {
        assert.deepEqual(got.perPayment, c.expect.perPayment);
      }
      if (c.expect.monthly) {
        assert.deepEqual(got.monthly, c.expect.monthly);
      }
      if (c.expect.effectiveRatePercent != null) {
        assert.equal(got.effectiveRatePercent, c.expect.effectiveRatePercent);
      }
    });
  }
});

describe('Проверка предельных значений Банка России', () => {
  for (const c of ceilingCases) {
    test(`${c.id} — ${c.title}`, () => {
      const group = findCeilingGroup(registry, c.group);
      const got = regulatoryCeiling(group, c.amount);
      assert.equal(got.perPayment, c.expect.perPayment);
      assert.equal(got.capReached, c.expect.capReached);
    });
  }
});

describe('Поведение при недостатке данных', () => {
  test('все предложения по СБП в основном контексте нерасчётны и объясняют почему', () => {
    const sbp = registry.offers.filter(
      (o) => o.method === 'sbp' && o.context === registry.meta.primary_context,
    );
    assert.ok(sbp.length >= 2);
    for (const o of sbp) {
      const r = calculateOffer(o, { amount: 1000, monthlyTurnover: 1000000 });
      assert.equal(r.verdict, Verdict.NOT_DETERMINABLE, `${o.id} должно быть нерасчётным`);
      assert.ok(r.reason.length > 20, `${o.id}: нет внятной причины`);
    }
  });

  test('отказ никогда не содержит числовой платы', () => {
    for (const o of registry.offers) {
      const r = calculateOffer(o, { amount: 1000, monthlyTurnover: 100 });
      if (r.verdict !== Verdict.OK) {
        assert.equal(r.monthly, undefined, `${o.id}: отказ не должен содержать сумм`);
        assert.equal(r.perPayment, undefined, `${o.id}: отказ не должен содержать сумм`);
      }
    }
  });
});
