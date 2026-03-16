import React from 'react';
import { motion } from 'motion/react';
import { Plus, MoreHorizontal, Sparkles, GripVertical } from 'lucide-react';
import { mockChapters, mockCharacters } from '../mockData';

export const Storyboard: React.FC = () => {
  return (
    <div className="p-8 h-screen flex flex-col space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-serif font-bold">Storyboard</h2>
          <p className="text-ink/50 text-sm">Structure your narrative and visualize the flow.</p>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-white border border-black/5 rounded-lg text-sm font-medium hover:bg-parchment transition-colors">
            Filter View
          </button>
          <button className="px-4 py-2 bg-ink text-parchment rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors flex items-center gap-2">
            <Plus size={18} />
            <span>Add Chapter</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-x-auto pb-8">
        <div className="flex gap-6 h-full min-w-max">
          {mockChapters.map((chapter) => (
            <div key={chapter.id} className="w-80 flex flex-col gap-4">
              <div className="flex justify-between items-center px-2">
                <h4 className="font-serif font-bold text-lg">{chapter.title}</h4>
                <button className="p-1 hover:bg-black/5 rounded text-ink/40">
                  <MoreHorizontal size={18} />
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto pr-2">
                {chapter.scenes.map((scene) => (
                  <motion.div
                    key={scene.id}
                    whileHover={{ y: -4 }}
                    className="bg-white p-4 rounded-xl border border-black/5 shadow-sm space-y-3 cursor-pointer group"
                  >
                    <div className="flex justify-between items-start">
                      <h5 className="font-medium text-sm group-hover:text-gold transition-colors">{scene.title}</h5>
                      <GripVertical size={16} className="text-ink/10 group-hover:text-ink/30" />
                    </div>
                    <p className="text-xs text-ink/50 line-clamp-3 leading-relaxed">
                      {scene.content}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {scene.povId && (
                        <span className="px-2 py-0.5 bg-parchment rounded text-[10px] font-medium text-ink/60">
                          POV: {mockCharacters.find(c => c.id === scene.povId)?.name}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        scene.status === 'complete' ? 'bg-forest/10 text-forest' : 
                        scene.status === 'review' ? 'bg-gold/10 text-gold' : 'bg-ink/5 text-ink/40'
                      }`}>
                        {scene.status}
                      </span>
                    </div>
                  </motion.div>
                ))}
                <button className="w-full py-3 border-2 border-dashed border-black/5 rounded-xl text-ink/20 hover:text-ink/40 hover:border-black/10 transition-all flex items-center justify-center gap-2">
                  <Plus size={18} />
                  <span className="text-sm font-medium">New Scene</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
