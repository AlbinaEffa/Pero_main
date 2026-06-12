/**
 * Фирменный знак Перо: гусиное перо, оставляющее чернильный росчерк.
 * Рисован под дизайн-систему (DESIGN.md): одна краска (currentColor),
 * работает чернилами на пергаменте и пергаментом на чернилах.
 */

interface MarkProps {
  size?: number;
  className?: string;
}

/** Знак-перо. Цвет наследует от currentColor. */
export function PeroMark({ size = 28, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 68"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* левый контур опахала */}
      <path d="M51 7 C41.5 9.5 33 15.5 26.5 24 C21 31 17 39.5 15.2 49" />
      {/* правый контур опахала */}
      <path d="M51 7 C53.5 16.5 51.5 26.5 45.5 34.5 C40.5 41.2 33 46.8 25 48.8" />
      {/* стержень до кончика-пера */}
      <path d="M51 7 C43.5 17 35.5 28.5 28.5 38.5 C24 45 19.5 51.5 15.2 57.5" />
      {/* срезы бородок — то, что отличает перо от листа */}
      <path d="M33.5 31.5 C36.5 32.4 40.5 31.8 43.8 29.8" strokeWidth="2.4" opacity="0.75" />
      <path d="M25 43 C28 43.8 31.5 43.3 34.6 41.6" strokeWidth="2.4" opacity="0.75" />
      {/* чернильный росчерк из-под пера */}
      <path d="M14 61.5 C23 63.8 35 63.8 45.5 61" strokeWidth="2.6" opacity="0.45" />
    </svg>
  );
}

interface LogoProps {
  /** Размер знака; словесная часть масштабируется от него. */
  size?: number;
  /** Показывать ли слово «Перо» рядом со знаком. */
  withWordmark?: boolean;
  className?: string;
}

/** Полный логотип: знак + «Перо» в Cormorant. Цвет — от currentColor родителя. */
export function PeroLogo({ size = 24, withWordmark = true, className }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <PeroMark size={size} />
      {withWordmark && (
        <span
          className="font-serif font-semibold tracking-wide leading-none"
          style={{ fontSize: size * 0.92 }}
        >
          Перо
        </span>
      )}
    </span>
  );
}
