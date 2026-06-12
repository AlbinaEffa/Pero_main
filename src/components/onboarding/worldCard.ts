/**
 * Генерация PNG-«визитки мира» — карточки книги для писательских чатов.
 * Чистый canvas, без зависимостей. Стиль — пигменты на пергаменте (DESIGN.md).
 */

interface WorldCardData {
  title: string;
  characters: number;
  locations: number;
  items: number;
  rules: number;
  events: number;
  majorNames: string[];
}

export async function downloadWorldCard(data: WorldCardData): Promise<void> {
  // Дождаться загрузки фирменных шрифтов, иначе canvas нарисует системным
  try { await (document as any).fonts?.ready; } catch { /* не критично */ }

  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Пергамент + тонкая рамка
  ctx.fillStyle = '#F5F0E8';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(30,45,31,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = 'rgba(30,45,31,0.08)';
  ctx.strokeRect(36, 36, W - 72, H - 72);

  // Перо-вензель
  ctx.font = '44px serif';
  ctx.textAlign = 'center';
  ctx.fillText('🪶', W / 2, 116);

  // Название книги
  ctx.fillStyle = '#1E2D1F';
  ctx.font = '600 64px "Cormorant Garamond", Georgia, serif';
  const title = data.title.length > 36 ? data.title.slice(0, 35) + '…' : data.title;
  ctx.fillText(title, W / 2, 196);

  ctx.font = 'italic 26px "Cormorant Garamond", Georgia, serif';
  ctx.fillStyle = 'rgba(30,45,31,0.55)';
  ctx.fillText('карта мира', W / 2, 236);

  // Счётчики пигментами
  const stats: [number, string, string][] = [
    [data.characters, plural(data.characters, 'душа', 'души', 'душ'), '#A14F44'],
    [data.locations,  plural(data.locations, 'место', 'места', 'мест'), '#4A5D4E'],
    [data.items,      plural(data.items, 'предмет', 'предмета', 'предметов'), '#91682E'],
    [data.events,     plural(data.events, 'событие', 'события', 'событий'), '#71597F'],
  ].filter(([n]) => (n as number) > 0) as [number, string, string][];

  const colW = 220;
  const startX = W / 2 - (stats.length * colW) / 2 + colW / 2;
  stats.forEach(([n, label, color], i) => {
    const x = startX + i * colW;
    ctx.fillStyle = color;
    ctx.font = '600 72px "Cormorant Garamond", Georgia, serif';
    ctx.fillText(String(n), x, 350);
    ctx.fillStyle = 'rgba(30,45,31,0.6)';
    ctx.font = '600 19px "Golos Text", sans-serif';
    ctx.fillText(label, x, 384);
  });

  // Главные герои
  if (data.majorNames.length > 0) {
    ctx.fillStyle = 'rgba(30,45,31,0.4)';
    ctx.font = '700 15px "Golos Text", sans-serif';
    ctx.fillText('В СЕРДЦЕ ИСТОРИИ', W / 2, 452);
    ctx.fillStyle = '#1E2D1F';
    ctx.font = '600 30px "Cormorant Garamond", Georgia, serif';
    ctx.fillText(data.majorNames.slice(0, 3).join(' · '), W / 2, 492);
  }

  // Подпись
  ctx.fillStyle = 'rgba(30,45,31,0.45)';
  ctx.font = '500 17px "Golos Text", sans-serif';
  ctx.fillText('Перо помнит — автор пишет · pero', W / 2, 566);

  // Скачать
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${data.title.replace(/[^\wа-яё\- ]/gi, '').trim().replace(/\s+/g, '-') || 'karta-mira'}.png`;
  a.click();
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
