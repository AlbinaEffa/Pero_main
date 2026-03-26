import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({apiKey: 'AIzaSyCEyQvxrrXeIq1wMPSVfujKJUsbrGA7bsU'});
ai.models.generateContent({model: 'gemini-2.5-flash', contents: 'Hello'}).then(res => console.log(res.text)).catch(e => console.error(e));
