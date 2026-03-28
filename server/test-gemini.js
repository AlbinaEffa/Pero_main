import { GoogleGenAI } from '@google/genai';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

ai.models
  .generateContent({ model: 'gemini-2.5-flash', contents: 'Hello' })
  .then((res) => console.log(res.text))
  .catch((e) => console.error(e));
