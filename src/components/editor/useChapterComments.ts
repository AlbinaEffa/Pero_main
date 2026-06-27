/**
 * useChapterComments — кластер комментариев главы, вынесенный из Editor.tsx (дробление мегафайла).
 * Авторские пометки к диапазону текста: загрузка, создание (марка + строка в БД + размещение
 * карточки на полях/поповером), правка, ответы-треды, resolve/delete/«в заметку».
 *
 * Сцепка с редактором проброшена явно: editorRef (марки), forceSave (фиксация марки в контенте),
 * companionCollapsedRef (решение гаттер↔поповер), onPromotedToNote (бамп версии заметок).
 * Гаттер и onClick-обработчик марки остаются в Editor и потребляют возвраты.
 */
import { useState, useEffect, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { type Editor as TiptapEditor } from '@tiptap/react';
import { type CommentData } from './CommentPopover';
import { api } from '../../services/api';

export type CommentPopoverState = { comment: CommentData; x: number; y: number; startEditing?: boolean } | null;

export function useChapterComments(opts: {
  projectId: string | undefined;
  chapterId: string | undefined;
  editorRef: MutableRefObject<TiptapEditor | null>;
  forceSave: (html: string) => Promise<unknown>;
  companionCollapsedRef: MutableRefObject<boolean>;
  onPromotedToNote: () => void;
}) {
  const { projectId, chapterId, editorRef, forceSave, companionCollapsedRef, onPromotedToNote } = opts;

  const [comments, setComments] = useState<CommentData[]>([]);
  const [commentPopover, setCommentPopover] = useState<CommentPopoverState>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

  // Комментарии текущей главы — грузим при смене главы.
  const loadComments = useCallback(() => {
    if (!projectId || !chapterId) { setComments([]); return; }
    api.get<{ comments: any[] }>(`/comments/${projectId}?chapterId=${chapterId}`)
      .then(d => setComments((d.comments ?? []).filter(c => !c.resolved).map(c => ({
        id: c.id, body: c.body ?? '', quote: c.quote ?? '', source: c.source === 'pero' ? 'pero' : 'author', resolved: !!c.resolved,
        replies: Array.isArray(c.replies) ? c.replies : [],
      }))))
      .catch(() => setComments([]));
  }, [projectId, chapterId]);
  useEffect(() => { loadComments(); }, [loadComments]);

  // Создать комментарий из выделения: навесить марку + строку в БД + открыть карточку.
  const handleCreateComment = useCallback(async (text: string) => {
    if (!editorRef.current || !projectId || !chapterId) return;
    const ed = editorRef.current;
    const { from, to } = ed.state.selection;
    if (from === to) return;
    const id = crypto.randomUUID();
    const quote = text.slice(0, 2000);
    ed.chain().focus().setTextSelection({ from, to }).setComment(id, 'author').run();
    let x = window.innerWidth / 2, y = 200;
    try { const c = ed.view.coordsAtPos(to); x = c.left; y = c.bottom; } catch { /* keep defaults */ }
    const fresh: CommentData = { id, body: '', quote, source: 'author', resolved: false };
    setComments(prev => [...prev, fresh]);
    // Спутник свёрнут на широком экране → карточка на полях (гаттер). Иначе (спутник открыт или
    // узкий экран) → инлайн-поповер у текста — НЕ трогаем спутник, не конфликтуем с ним.
    if (window.matchMedia('(min-width: 1024px)').matches && companionCollapsedRef.current) {
      setActiveCommentId(id);
    } else setCommentPopover({ comment: fresh, x, y, startEditing: true });
    try {
      await api.post(`/comments/${projectId}`, { id, chapterId, quote, source: 'author' });
      await forceSave(ed.getHTML()); // зафиксировать марку в контенте сразу
    } catch {
      // POST не прошёл → откатываем марку, чтобы не осталось «мёртвой» подсветки без строки в БД.
      ed.commands.removeCommentById(id);
      forceSave(ed.getHTML()).catch(() => {});
      setComments(prev => prev.filter(c => c.id !== id));
      setActiveCommentId(prev => (prev === id ? null : prev));
      setCommentPopover(prev => (prev?.comment.id === id ? null : prev));
    }
  }, [projectId, chapterId, editorRef, forceSave, companionCollapsedRef]);

  const handleSaveComment = useCallback(async (id: string, body: string) => {
    setComments(prev => prev.map(c => c.id === id ? { ...c, body } : c));
    try { await api.patch(`/comments/item/${id}`, { body }); }
    catch { loadComments(); } // ресинк с сервером, чтобы локально не разъехалось молча
  }, [loadComments]);

  // resolve / delete / to-note — общий хвост: снять марку из текста + убрать из списка + закрыть.
  const dropCommentMark = useCallback((id: string) => {
    const ed = editorRef.current;
    if (ed) { ed.commands.removeCommentById(id); forceSave(ed.getHTML()).catch(() => {}); }
    setComments(prev => prev.filter(c => c.id !== id));
    setCommentPopover(null);
    setActiveCommentId(prev => (prev === id ? null : prev));
  }, [editorRef, forceSave]);

  // Терминальные действия — сначала сервер, потом снимаем марку. Ошибка → ничего не меняем
  // (не остаётся «решённого/удалённого» без записи в БД и наоборот).
  const handleResolveComment = useCallback(async (id: string) => {
    try { await api.patch(`/comments/item/${id}`, { resolved: true }); dropCommentMark(id); } catch { /* оставляем как есть */ }
  }, [dropCommentMark]);

  const handleDeleteComment = useCallback(async (id: string) => {
    try { await api.delete(`/comments/item/${id}`); dropCommentMark(id); } catch { /* оставляем как есть */ }
  }, [dropCommentMark]);

  const handleCommentToNote = useCallback(async (id: string) => {
    try { await api.post(`/comments/item/${id}/to-note`, {}); dropCommentMark(id); onPromotedToNote(); } catch { /* оставляем как есть */ }
  }, [dropCommentMark, onPromotedToNote]);

  // Ответить в тред комментария (как в Word). Оптимистично добавляем, сервер вернёт канон.
  const handleReplyComment = useCallback(async (id: string, body: string) => {
    const optimistic = { id: crypto.randomUUID(), body, author: 'author' as const, createdAt: new Date().toISOString() };
    setComments(prev => prev.map(c => c.id === id ? { ...c, replies: [...(c.replies ?? []), optimistic] } : c));
    try {
      const row = await api.post<{ replies?: any[] }>(`/comments/item/${id}/reply`, { body });
      if (row?.replies) setComments(prev => prev.map(c => c.id === id ? { ...c, replies: row.replies } : c));
    } catch { loadComments(); }
  }, [loadComments]);

  return {
    comments,
    commentPopover, setCommentPopover,
    activeCommentId, setActiveCommentId,
    handleCreateComment, handleSaveComment,
    handleResolveComment, handleDeleteComment, handleCommentToNote, handleReplyComment,
  };
}
