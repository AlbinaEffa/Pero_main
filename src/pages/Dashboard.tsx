import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Bell, Plus, User, Settings, HelpCircle, FileText, Upload, X } from 'lucide-react';

const Book = ({ title, color, height, id }: { title: string, color: string, height: string, id?: string }) => {
  const navigate = useNavigate();
  
  return (
    <button 
      onClick={() => id && navigate(`/editor/${id}`)}
      className={`${height} w-16 flex items-center justify-center transition-transform hover:-translate-y-2 cursor-pointer shadow-sm relative group`}
      style={{ backgroundColor: color }}
    >
      <span 
        className="text-white/90 font-serif text-sm tracking-widest whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {title}
      </span>
      {/* Book spine details */}
      <div className="absolute top-4 w-full h-px bg-white/20"></div>
      <div className="absolute top-6 w-full h-px bg-white/20"></div>
      <div className="absolute bottom-4 w-full h-px bg-white/20"></div>
      <div className="absolute bottom-6 w-full h-px bg-white/20"></div>
    </button>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [projectData, setProjectData] = useState({ title: '', genre: '', color: '#3A4F41' });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setSelectedFile(file);
    setIsUploading(true);
    
    // Имитация считывания данных из файла
    setTimeout(() => {
      setIsUploading(false);
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      setProjectData(prev => ({ ...prev, title: nameWithoutExt }));
    }, 1500);
  };

  const handleCreateProject = () => {
    setIsModalOpen(false);
    // В будущем здесь будет логика сохранения в БД
    navigate('/editor/new');
  };

  return (
    <div className="min-h-screen bg-[#F4F1E9] text-[#333333] font-sans flex flex-col">
      <div className="max-w-6xl mx-auto w-full px-8 py-12 flex-1 flex flex-col">
        {/* Header */}
        <header className="flex justify-between items-center mb-16">
          <h1 className="text-5xl font-serif italic tracking-tight text-black/80">Ваши проекты</h1>
          <div className="flex items-center gap-6">
            <button className="text-black/60 hover:text-black transition-colors"><Search size={22} /></button>
            <button className="text-black/60 hover:text-black transition-colors"><Bell size={22} /></button>
            
            <button 
              onClick={() => setIsModalOpen(true)}
              className="bg-[#3A4F41] text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-[#2C3E30] transition-colors flex items-center gap-2 shadow-sm"
            >
              <Plus size={18} /> Новый проект
            </button>

            <button className="w-10 h-10 rounded-full bg-[#E2DFD8] flex items-center justify-center text-black/60 hover:bg-[#D5D1C8] transition-colors">
              <User size={20} />
            </button>
          </div>
        </header>

        {/* Current Projects */}
        <div className="mb-24">
          <div className="flex items-center gap-4 mb-8">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">ТЕКУЩИЕ</h2>
            <div className="flex-1 h-px bg-black/10"></div>
          </div>
          
          <div className="relative">
            {/* Books Container */}
            <div className="flex items-end gap-3 px-8 relative z-10">
              <Book title="Хроники Мха" color="#3A4F41" height="h-64" id="1" />
              <Book title="Глиняные тропы" color="#C66B49" height="h-52" id="2" />
              <Book title="Темные небеса" color="#2C3E50" height="h-72" id="3" />
              <Book title="Тихая проза" color="#806B8A" height="h-48" id="4" />
              <Book title="Бирюзовые воды" color="#2B7A6B" height="h-60" id="5" />
            </div>
            {/* Shelf */}
            <div className="w-full h-4 bg-[#8B6B32] border-b-4 border-[#6E5425] shadow-sm relative z-0"></div>
          </div>
        </div>

        {/* Archive */}
        <div className="mb-16">
          <div className="flex items-center gap-4 mb-8">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-black/40">АРХИВ</h2>
            <div className="flex-1 h-px bg-black/10"></div>
          </div>
          
          <div className="relative">
            {/* Books Container */}
            <div className="flex items-end gap-3 px-8 relative z-10">
              <Book title="Старые воспоминания" color="#BDBDBD" height="h-52" />
              <Book title="Забытые сказки" color="#CCCCCC" height="h-44" />
              <Book title="Тихий город" color="#B0B0B0" height="h-60" />
            </div>
            {/* Shelf */}
            <div className="w-full h-4 bg-[#8B6B32] border-b-4 border-[#6E5425] shadow-sm relative z-0"></div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-auto pt-8 flex justify-between items-center text-sm text-black/50">
          <div className="flex gap-6">
            <span>Написано за неделю: <strong className="text-black font-medium">12,402 слов</strong></span>
            <span>Всего проектов: <strong className="text-black font-medium">8</strong></span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/settings')} className="hover:text-black transition-colors"><Settings size={18} /></button>
            <button className="hover:text-black transition-colors"><HelpCircle size={18} /></button>
          </div>
        </footer>
      </div>

      {/* New Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F4F1E9] rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-black/10 flex justify-between items-center bg-white">
              <h2 className="text-2xl font-serif font-bold">Новый проект</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-6">
              {/* File Upload Area */}
              <div 
                className="border-2 border-dashed border-black/20 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-black/5 transition-colors cursor-pointer bg-white/50"
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                   <div className="flex flex-col items-center">
                     <div className="w-8 h-8 border-4 border-black/20 border-t-black rounded-full animate-spin mb-3"></div>
                     <span className="text-sm font-medium">Анализ файла...</span>
                   </div>
                ) : selectedFile ? (
                   <div className="flex flex-col items-center">
                     <FileText size={32} className="text-[#3A4F41] mb-3" />
                     <span className="font-medium">{selectedFile.name}</span>
                     <span className="text-xs text-[#3A4F41] mt-1 font-medium">Данные успешно считаны</span>
                   </div>
                ) : (
                   <>
                     <Upload size={32} className="text-black/40 mb-3" />
                     <span className="font-medium mb-1">Загрузить рукопись</span>
                     <span className="text-xs text-black/50">PDF, DOCX или EPUB</span>
                   </>
                )}
              </div>
              <input 
                type="file" 
                ref={fileInputRef}
                accept=".pdf,.docx,.epub" 
                className="hidden" 
                onChange={handleFileSelect} 
              />

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-black/10"></div>
                <span className="text-xs font-bold uppercase tracking-widest text-black/40">ИЛИ ВРУЧНУЮ</span>
                <div className="flex-1 h-px bg-black/10"></div>
              </div>

              {/* Form Fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-black/70 mb-1">Название книги</label>
                  <input 
                    type="text" 
                    value={projectData.title}
                    onChange={(e) => setProjectData({...projectData, title: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl bg-white border border-black/10 focus:border-[#3A4F41] focus:ring-1 focus:ring-[#3A4F41] outline-none transition-all"
                    placeholder="Например: Хроники Мха"
                  />
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-black/70 mb-1">Жанр</label>
                    <input 
                      type="text" 
                      value={projectData.genre}
                      onChange={(e) => setProjectData({...projectData, genre: e.target.value})}
                      className="w-full px-4 py-2.5 rounded-xl bg-white border border-black/10 focus:border-[#3A4F41] focus:ring-1 focus:ring-[#3A4F41] outline-none transition-all"
                      placeholder="Фэнтези"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black/70 mb-1">Цвет обложки</label>
                    <input 
                      type="color" 
                      value={projectData.color}
                      onChange={(e) => setProjectData({...projectData, color: e.target.value})}
                      className="w-full h-11 rounded-xl cursor-pointer bg-white border border-black/10 p-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-white border-t border-black/10 flex justify-end gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-black/70 hover:bg-black/5 transition-colors"
              >
                Отмена
              </button>
              <button 
                onClick={handleCreateProject}
                disabled={!projectData.title && !selectedFile}
                className="bg-[#3A4F41] text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-[#2C3E30] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Создать проект
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
