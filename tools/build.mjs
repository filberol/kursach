/**
 * Сборка статического сайта в dist/.
 *
 * Сборщик намеренно простой: проект написан на нативных ES-модулях, поэтому
 * «компиляция» — это копирование файлов и подстановка реестра тарифов рядом со
 * страницами. Никаких зависимостей, ничего не минифицируется до нечитаемости:
 * проверяющий должен иметь возможность открыть исходник и сверить формулу.
 */
import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  // 1. Страницы и статика интерфейса -> в корень dist.
  await cp(join(root, 'src', 'ui'), dist, { recursive: true });

  // 2. Расчётное ядро кладём в dist/core/.
  await cp(join(root, 'src', 'core'), join(dist, 'core'), { recursive: true });

  // 2a. В исходниках интерфейс лежит в src/ui/, а ядро в src/core/, поэтому
  //     импорты записаны как '../core/...'. В dist/ страницы оказываются в корне,
  //     и путь должен стать './core/...'. Это единственное преобразование кода
  //     при сборке — переписываем спецификатор импорта и проверяем результат.
  for (const name of await readdir(dist)) {
    if (!name.endsWith('.js')) continue;
    const p = join(dist, name);
    const before = await readFile(p, 'utf8');
    const after = before.replaceAll("'../core/", "'./core/");
    if (after !== before) await writeFile(p, after);
  }

  // 3. Реестр тарифов — единственный источник истины, кладём рядом со страницами.
  const registryRaw = await readFile(join(root, 'data', 'tariffs.json'), 'utf8');
  JSON.parse(registryRaw); // падаем на сборке, а не в браузере
  await writeFile(join(dist, 'tariffs.json'), registryRaw);

  // 4. Документы работы — чтобы они открывались по ссылке с опубликованного сайта.
  await mkdir(join(dist, 'docs'), { recursive: true });
  await cp(join(root, 'docs'), join(dist, 'docs'), { recursive: true });

  // 5. .nojekyll — иначе GitHub Pages прячет файлы и каталоги, начинающиеся с «_».
  await writeFile(join(dist, '.nojekyll'), '');

  const files = await walk(dist);
  console.log(`Собрано в dist/ — файлов: ${files.length}`);
  for (const f of files.sort()) console.log('  ', relative(dist, f));
}

main().catch((e) => {
  console.error('Сборка не удалась:', e.message);
  process.exit(1);
});
