/**
 * Статическая проверка интерфейса без браузера.
 *
 * Эти тесты не рисуют страницу, но ловят самые частые поломки статической
 * сборки: несуществующий путь импорта и обращение к элементу, которого нет
 * в разметке. Именно так был найден баг с путём '../core/' в dist/.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

before(() => {
  // Проверяем именно собранный результат — то, что попадёт на GitHub Pages.
  execFileSync(process.execPath, [join(root, 'tools', 'build.mjs')], { stdio: 'pipe' });
});

const PAGES = [
  { html: 'index.html', script: 'app.js' },
  { html: 'sources.html', script: 'sources.js' },
];

function relativeImports(code) {
  const out = [];
  const re = /(?:import|from)\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}

describe('Собранный сайт', () => {
  test('в dist есть все обязательные файлы', () => {
    for (const f of ['index.html', 'sources.html', 'tariffs.json', 'core/calc.js', 'core/registry.js', '.nojekyll']) {
      assert.ok(existsSync(join(dist, f)), `нет файла dist/${f}`);
    }
  });

  test('реестр в dist — валидный JSON и совпадает с исходным', () => {
    const a = readFileSync(join(dist, 'tariffs.json'), 'utf8');
    const b = readFileSync(join(root, 'data', 'tariffs.json'), 'utf8');
    JSON.parse(a);
    assert.equal(a, b, 'реестр в сборке отличается от data/tariffs.json');
  });

  test('все относительные импорты в dist разрешаются в существующие файлы', () => {
    const scripts = ['app.js', 'sources.js', 'chart.js', 'format.js', 'core/calc.js', 'core/registry.js'];
    for (const s of scripts) {
      const file = join(dist, s);
      const code = readFileSync(file, 'utf8');
      for (const spec of relativeImports(code)) {
        const target = resolve(dirname(file), spec);
        assert.ok(existsSync(target), `${s}: импорт «${spec}» указывает в никуда (${target})`);
        assert.ok(target.startsWith(dist), `${s}: импорт «${spec}» выходит за пределы dist`);
      }
    }
  });

  test('атрибут hidden не перебивается display-правилами компонентов', () => {
    // .md-field задаёт display:block, поэтому без сброса [hidden] скрытые поля
    // (например, «Число терминалов» в онлайн-контексте) остаются на экране.
    const css = readFileSync(join(dist, 'styles', 'm3.css'), 'utf8');
    assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
      'в m3.css нет сброса [hidden] { display: none !important }');
  });

  for (const page of PAGES) {
    test(`${page.html}: все элементы, запрашиваемые скриптом, есть в разметке`, () => {
      const html = readFileSync(join(dist, page.html), 'utf8');
      const code = readFileSync(join(dist, page.script), 'utf8');

      const ids = new Set();
      for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);

      const wanted = new Set();
      for (const m of code.matchAll(/\$\('([^']+)'\)/g)) wanted.add(m[1]);
      for (const m of code.matchAll(/getElementById\('([^']+)'\)/g)) wanted.add(m[1]);

      assert.ok(wanted.size > 0, 'скрипт не обращается ни к одному элементу — проверка бессмысленна');
      for (const id of wanted) {
        assert.ok(ids.has(id), `${page.html}: скрипт ищет #${id}, которого нет в разметке`);
      }
    });

    test(`${page.html}: подключённые локальные ресурсы существуют`, () => {
      const html = readFileSync(join(dist, page.html), 'utf8');
      const refs = [
        ...[...html.matchAll(/<link[^>]+href="(\.[^"]+)"/g)].map((m) => m[1]),
        ...[...html.matchAll(/<script[^>]+src="(\.[^"]+)"/g)].map((m) => m[1]),
        ...[...html.matchAll(/<a[^>]+href="(\.\/[^"#]+)"/g)].map((m) => m[1]),
      ];
      assert.ok(refs.length > 0);
      for (const r of refs) {
        assert.ok(existsSync(join(dist, r)), `${page.html}: ресурс ${r} отсутствует в сборке`);
      }
    });
  }
});
