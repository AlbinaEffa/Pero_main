/**
 * Маргиналии — рисованные линией иллюстрации для пустых состояний линз и панелей.
 * Чернильный контур, без заливки (DESIGN.md: «hand-drawn black-stroke, no fill»),
 * наследуют цвет через currentColor — родитель задаёт приглушённую краску. Это «1%»-
 * подпись писательского блокнота: дудл на полях вместо безликой иконки.
 *
 * Линия чуть «живая» (неидеальные кривые, round caps) — ощущается нарисованной от руки,
 * а не сгенерированной. Размер задаётся пропом size; цвет/прозрачность — className.
 */
interface MargProps { size?: number; className?: string; }

const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 64 64',
  fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  xmlns: 'http://www.w3.org/2000/svg',
});

/** Раскрытая книга — «Каталог», общий мир. */
export function MargOpenBook({ size = 52, className }: MargProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M32 17C25 13 15 12.5 8.5 15.5L8.5 47.5C15 44.8 25 45.2 32 49" />
      <path d="M32 17C39 13 49 12.5 55.5 15.5L55.5 47.5C49 44.8 39 45.2 32 49" />
      <path d="M32 17.5L32 49" />
      <path d="M13.5 23.5C17 22.7 21.5 22.8 25.5 23.6" />
      <path d="M13.5 29.5C17 28.8 21 28.9 24.5 29.5" />
      <path d="M38.5 23.6C42.5 22.8 47 22.7 50.5 23.5" />
      <path d="M39.5 29.5C43 28.9 47 28.8 50.5 29.5" />
    </svg>
  );
}

/** Созвездие — «Присутствие»: точки появлений, связанные тонкой линией. */
export function MargConstellation({ size = 52, className }: MargProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 40L24 26L37 33L52 18" strokeOpacity={0.5} />
      <circle cx="12" cy="40" r="2.4" />
      <circle cx="24" cy="26" r="3.2" />
      <circle cx="37" cy="33" r="2.4" />
      <circle cx="52" cy="18" r="3" />
      {/* маленькая звёздочка-росчерк */}
      <path d="M45 44L45 52M41 48L49 48" strokeOpacity={0.6} />
      <path d="M17 14L17 20M14 17L20 17" strokeOpacity={0.45} />
    </svg>
  );
}

/** Паутинка связей — «Связи»: узел в центре и соседи. */
export function MargWeb({ size = 52, className }: MargProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M32 32L16 18M32 32L50 20M32 32L20 48M32 32L46 47" strokeOpacity={0.5} />
      <circle cx="32" cy="32" r="5" />
      <circle cx="16" cy="18" r="3" />
      <circle cx="50" cy="20" r="2.6" />
      <circle cx="20" cy="48" r="2.6" />
      <circle cx="46" cy="47" r="3" />
    </svg>
  );
}

/** Компас — «Карта»: вложенность/пространство мира. */
export function MargCompass({ size = 52, className }: MargProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="22" />
      <path d="M32 10L32 15M32 49L32 54M10 32L15 32M49 32L54 32" strokeOpacity={0.55} />
      {/* стрелка-ромб */}
      <path d="M32 20L39 32L32 44L25 32Z" />
      <circle cx="32" cy="32" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Вьющаяся тропа с вехами — «Таймлайн/Арки». */
export function MargPath({ size = 52, className }: MargProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M16 12C40 18 12 30 36 38C54 44 26 52 44 54" strokeOpacity={0.55} strokeDasharray="1 5" />
      <circle cx="16" cy="12" r="2.8" />
      <circle cx="33" cy="34" r="2.4" />
      <circle cx="44" cy="54" r="2.8" />
    </svg>
  );
}
