/** Форматирование чисел, денег и дат в русской локали. */

const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export const money = (v) => (v == null ? '—' : `${nf2.format(v)} ₽`);
export const moneyShort = (v) => (v == null ? '—' : `${nf0.format(v)} ₽`);

export const percent = (v) =>
  v == null ? '—' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v)}%`;

/** Компактная подпись для оси: 2 млн ₽, 500 тыс ₽. */
export function moneyAxis(v) {
  if (v == null) return '';
  if (Math.abs(v) >= 1e6) {
    const m = v / 1e6;
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(m)} млн`;
  }
  if (Math.abs(v) >= 1e3) return `${nf0.format(v / 1e3)} тыс`;
  return nf0.format(v);
}

export function date(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d ? `${d}.${m}.${y}` : iso;
}

/** Как именно проверен источник. Показывается в раскрывающемся блоке, не ярлыком. */
export const VERIFICATION_TEXT = {
  live: 'загружено с живой страницы',
  snapshot: 'датированный снимок Архива Интернета',
  stale_snapshot: 'устаревший снимок — для расчёта не используется',
};
