import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BookOpen, Telescope } from 'lucide-react';
import { Entity } from './types';

interface Props {
  editor: Editor | null;
  entities: Entity[];
  onShowInWorld: (entity: Entity) => void;
  onWhereUsed: (entity: Entity) => void;
}

interface MenuState {
  entity: Entity;
  left: number;
  top: number;
}

/**
 * Контекстный вызов: выделил в тексте имя сущности — рядом всплывает мини-меню
 * «Показать в Мире / Где встречается». Инструмент приходит к тебе, в контексте, вместо
 * того чтобы идти искать его в панели. Третья опора нативного управления (рельс — состояние,
 * ⌘K — намерение, выделение — контекст).
 */
export function EntitySelectionMenu({ editor, entities, onShowInWorld, onWhereUsed }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || to - from < 2) { setMenu(null); return; }
      const text = editor.state.doc.textBetween(from, to, ' ').trim();
      if (!text || text.length > 48) { setMenu(null); return; }
      const lower = text.toLowerCase();
      const entity = entities.find(e => e.name.trim().toLowerCase() === lower);
      if (!entity) { setMenu(null); return; }
      const coords = editor.view.coordsAtPos(from);
      setMenu({ entity, left: coords.left, top: coords.top });
    };

    const hide = () => setMenu(null);

    editor.on('selectionUpdate', update);
    editor.on('blur', hide);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('blur', hide);
    };
  }, [editor, entities]);

  if (!menu) return null;

  const choose = (fn: (e: Entity) => void) => {
    fn(menu.entity);
    setMenu(null);
  };

  return (
    <div
      style={{ position: 'fixed', left: menu.left, top: Math.max(8, menu.top - 46), zIndex: 70 }}
      // keep the editor selection alive — don't let the button steal focus
      onMouseDown={e => e.preventDefault()}
      className="flex items-center bg-[#1e2d1f] text-[#f5f0e8] rounded-xl shadow-2xl overflow-hidden text-[12px] font-medium animate-[fadeIn_0.1s_ease-out]"
    >
      <button
        onClick={() => choose(onShowInWorld)}
        className="flex items-center gap-1.5 pl-3 pr-2.5 py-2 hover:bg-white/10 transition-colors"
        title={`Показать «${menu.entity.name}» в Мире`}
      >
        <BookOpen size={13} /> В Мире
      </button>
      <span className="w-px h-4 bg-white/15" />
      <button
        onClick={() => choose(onWhereUsed)}
        className="flex items-center gap-1.5 pl-2.5 pr-3 py-2 hover:bg-white/10 transition-colors"
        title={`Найти все главы, где встречается «${menu.entity.name}»`}
      >
        <Telescope size={13} /> Где встречается
      </button>
    </div>
  );
}
