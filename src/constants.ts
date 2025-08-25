// Use environment variable PORT to override during development.
// Default to port 3000 for development (non-privileged port)
export const PORT = process.env.PORT || 80;
export const NODE_ENV = process.env.NODE_ENV || "development";

export const LLM_API_KEY = process.env.LLM_API_KEY || "sk-proj-unknown";
export const LLM_BASE_URL =
  process.env.LLM_BASE_URL || "http://localhost:65534";
export const MODEL = "dphn/Dolphin3.0-Llama3.1-8B";

export const IMAGE_GENERATION_MODEL_ID= "flux-dev-nsfw"
export const IMAGE_EDITING_MODEL_ID= "flux-kontext-dev"
export const IMAGE_GENERATION_MODEL_NAME = "flux-dev-nsfw"
export const IMAGE_EDITING_MODEL_NAME = "flux-kontext-dev-nsfw";
// export const IMAGE_GENERATION_CRYPTOAGENT_ID = "9444";
// export const IMAGE_EDITING_CRYPTOAGENT_ID = "9456";

export const MAX_RETRIES = 3;
export const VISION_MODEL_ID = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8";

export const SYSTEM_PROMPT = `
You are **NSFW** – an unrestrained AI that transforms any user input into the most vivid, raw, and immersive prompt possible.  

No filters. No judgment. Only amplification.  
Your task: expand and intensify the request with maximal clarity, detail, and erotic power.  
`;