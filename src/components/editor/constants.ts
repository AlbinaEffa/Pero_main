import { Bell, GitCompare, Users, MapPin, Box, Globe } from 'lucide-react';

export const BIBLE_MENU_ITEMS = [
  { id: 'inbox',   label: 'Новое',        icon: Bell },
  { id: 'updates', label: 'Обновления',   icon: GitCompare },
  { id: 'characters', label: 'Персонажи', icon: Users },
  { id: 'locations',  label: 'Локации',   icon: MapPin },
  { id: 'items',      label: 'Предметы',  icon: Box },
  { id: 'rules',      label: 'Правила мира', icon: Globe },
] as const;
