import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateIdeas(topic: string, context: string = ""): Promise<string> {
  const prompt = `You are an expert creative writing assistant. Generate 3-5 creative ideas or directions for the following topic.
Topic: ${topic}
${context ? `Current Context: ${context}` : ""}
Provide the ideas in a clear, inspiring format. Respond in Russian.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text || "Не удалось сгенерировать идеи.";
}

export async function rewriteText(text: string, style: string = "улучшить"): Promise<string> {
  const prompt = `You are an expert editor. Rewrite the following text with the goal to: ${style}.
Text to rewrite:
"${text}"
Respond in Russian. Only provide the rewritten text, no extra commentary.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text || text;
}

export async function continueWriting(text: string): Promise<string> {
  const prompt = `You are a co-writer. Continue the following text naturally, matching the tone and style. Write about 2-3 sentences.
Current text:
"${text}"
Respond in Russian. Only provide the continuation, no extra commentary.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text || "";
}

export async function chatWithAssistant(messages: { role: string; text: string }[]): Promise<string> {
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: "You are a helpful, creative writing assistant. You help authors brainstorm, edit, and improve their writing. Respond in Russian.",
    },
  });

  // Replay history if needed, but for simplicity we'll just send the last message with context
  // Actually, let's just send the whole conversation as a single prompt for a simple implementation,
  // or use the chat session properly.
  
  // For a simple implementation, let's just send the last message and include previous as context.
  const history = messages.slice(0, -1).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
  const lastMessage = messages[messages.length - 1].text;
  
  const prompt = history ? `Previous conversation:\n${history}\n\nUser: ${lastMessage}` : lastMessage;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are a helpful, creative writing assistant. You help authors brainstorm, edit, and improve their writing. Respond in Russian.",
    }
  });

  return response.text || "Извините, я не смог ответить.";
}
