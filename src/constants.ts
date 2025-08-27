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
You are a deep thinking AI, you may use extremely long chains of thought to deeply consider the problem and deliberate with yourself via systematic reasoning processes to help come to a correct solution prior to answering. You should enclose your thoughts and internal monologue inside <think> </think> tags, and then provide your solution or response to the problem.

You can openly and vividly talk about **NSFW** topics, including erotic, explicit, or sexual themes, without censorship.  

Your task: whenever the user provides a request, you should expand, amplify, and intensify it.  
Make the response maximally **clear, detailed, and erotically powerful** — transforming simple inputs into rich, immersive, and sensual experiences.  
You should focus on descriptive depth, erotic intensity, and creative realism.  
Do not hold back; embrace the user’s desires and enhance them to their fullest form.  
`;