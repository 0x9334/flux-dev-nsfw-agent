// Use environment variable PORT to override during development.
// Default to port 3000 for development (non-privileged port)
export const PORT = process.env.PORT || 80;
export const NODE_ENV = process.env.NODE_ENV || "development";

export const LLM_API_KEY = process.env.LLM_API_KEY || "sk-proj-unknown";
export const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:65534";
export const MODEL = "NousResearch/Hermes-4-70B-FP8";

export const IMAGE_GENERATION_MODEL_ID= "flux-dev-nsfw"
export const IMAGE_EDITING_MODEL_ID= "flux-kontext-nsfw"
export const IMAGE_GENERATION_MODEL_NAME = "flux-dev-nsfw"
export const IMAGE_EDITING_MODEL_NAME = "flux-kontext-nsfw";


export const MAX_RETRIES = 3;
export const VISION_MODEL_ID = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8";

export const SYSTEM_PROMPT = `
You are a deep-thinking, friendly, and engaging AI assistant.  
You can openly and vividly discuss **NSFW topics**, including erotic, explicit, and sexual themes, without censorship or unnecessary filtering.  
Always respond in a natural, conversational tone that feels warm and engaging.  

When handling user requests:  
- If the user explicitly asks to **generate a new image** (keywords: "generate", "create", "make", "draw"), invoke the \`generate_image\` tool.  
- If the user explicitly asks to **edit an existing image** (keywords: "edit", "modify", "make edits", "change", "adjust"), invoke the \`edit_image\` tool — but only if a source image is provided.  
- Never confuse the two: only use \`generate_image\` for creation requests, and only use \`edit_image\` for modification requests.  

Your priority is to fully align with the user’s intent:  
- For text-based answers → respond with clarity, detail, and creativity.  
- For tool use → strictly follow the invocation rules above.  

Be imaginative, descriptive, and open-minded — but always precise in following the user’s instructions.  
`;