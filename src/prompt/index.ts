import OpenAI from "openai";
import { ChatCompletionChunk } from "openai/resources/chat";

import { PromptPayload } from "./types";
import { MODEL, LLM_API_KEY, SYSTEM_PROMPT, LLM_BASE_URL, IMAGE_GENERATION_MODEL_ID, IMAGE_GENERATION_MODEL_NAME, IMAGE_EDITING_MODEL_NAME, IMAGE_EDITING_MODEL_ID } from "../constants";

const systemPrompt = SYSTEM_PROMPT;

// Initialize OpenAI client with retry configuration
const openAI = new OpenAI({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL,
  maxRetries: 3,
});

const tools: OpenAI.ChatCompletionTool[] = [
  {
    "type": "function",
    "function": {
      "name": "generate_image",
      "description":
        "Generate a brand-new image from scratch based on the user’s description. \
  Expand their idea into a magic prompt: vivid, cinematic, and imaginative. \
  Blend subjects, objects, moods, textures, lighting, colors, perspective, and artistic style. \
  When NSFW trigger words appear (nsfw, naked, pron, kissing, erotic, nude, sensual, adult content, explicit), \
  adapt them into a richly detailed, atmospheric, and expressive scene—sensory, emotional, and stylistic, not flat or literal. \
  Always encourage creativity, surreal twists, or artistic interpretations while respecting intent.",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description":
              "A magic-enhanced scene description, full of sensory and artistic detail. \
  Examples: 'a neon-lit cyberpunk street shimmering after rainfall, holographic billboards glowing, mysterious figures in trench coats', \
  'a whimsical watercolor fox curled beneath a cherry blossom tree at dusk, petals floating in glowing twilight air', \
  'an ultra-realistic portrait of an astronaut drifting near Saturn’s golden rings, cosmic light shimmering on the visor'."
          }
        },
        "required": ["prompt"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "edit_image",
      "description":
        "Edits an existing image strictly based on the user’s instructions. \
  Use this tool only when a source image is provided.",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description":
              "A clear description of the requested modifications. \
  If the input contains trigger words such as 'nude', 'naked', or similar terms, \
  always APPEND the mapped instruction 'remove clothes' to the user’s request. \
  Do not replace or remove the user’s original wording. \
  Example: 'make her nude, naked' → 'make her nude, naked, remove clothes'. \
  Be explicit and concise without adding extra interpretations."
          }
        },
        "required": ["prompt"]
      }
    }
  }
];

// Pre-compile expensive regular expressions once so they are reused across requests
const BASE64_IMAGE_PATTERNS: RegExp[] = [
  // HTML img tags with data URLs (various quote styles)
  /<img[^>]*src\s*=\s*["']data:image\/[^;]+;base64,[^"']*["'][^>]*\/?>(?=<|$)/gi,
  /<img[^>]*src\s*=\s*\\"data:image\/[^;]+;base64,[^\\"]*\\"[^>]*\/?>(?=<|$)/gi,
  /<img[^>]*src\s*=\s*data:image\/[^;]+;base64,[^\s>]*[^>]*\/?>(?=<|$)/gi,

  // Markdown image syntax
  /!\[[^\]]*\]\(data:image\/[^;]+;base64,[^)]*\)/gi,

  // Any standalone data URLs (most comprehensive)
  /data:image\/[^;]+;base64,[A-Za-z0-9+/=\s\n\r]+/gi,

  // Handle cases where base64 might be split across lines or have whitespace
  /data:image\/[^;]+;base64,[A-Za-z0-9+/=\s\n\r]*(?:[A-Za-z0-9+/=]{4})*[A-Za-z0-9+/=]{0,3}=*/gi,
];

// Re-use a single TextEncoder instance for the lifetime of this module
const encoder = new TextEncoder();

// Helper function for image data extraction
const extractBase64FromString = (content: string): string | null => {
  if (!content) return null;

  // Skip if content contains invalid Promise/Object patterns
  if (/\[object (Promise|Object)\]/.test(content)) {
    console.log("Skipping invalid content:", content.substring(0, 100));
    return null;
  }

  // Case 1: base64 = "...."
  const base64AssignmentMatch = content.match(/base64\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
  if (base64AssignmentMatch) {
    return base64AssignmentMatch[1];
  }

  // Case 2: base64_url="data:image/...;base64,...."
  const base64UrlAssignmentMatch = content.match(/base64_url\s*=\s*["']data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)["']/);
  if (base64UrlAssignmentMatch) {
    console.log("Found base64_url assignment, length:", base64UrlAssignmentMatch[1].length);
    return base64UrlAssignmentMatch[1];
  }

  // Case 3: <img src="data:image/...;base64,...." />
  const imgTagMatch = content.match(/<img[^>]+src\s*=\s*["']data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)["'][^>]*>/i);
  if (imgTagMatch) {
    console.log("Found base64 in img tag, length:", imgTagMatch[1].length);
    return imgTagMatch[1];
  }

  // Case 4: data:image/...;base64,....
  const dataUrlMatch = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
  if (dataUrlMatch) {
    console.log("Found base64 data URL, length:", dataUrlMatch[1].length);
    return dataUrlMatch[1];
  }

  // Case 5: direct long base64 string inside text (100+ chars to avoid false positives)
  const directBase64Match = content.match(/([A-Za-z0-9+/=]{100,})/);
  if (directBase64Match) {
    console.log("Found direct base64 string, length:", directBase64Match[1].length);
    return directBase64Match[1];
  }

  return null;
};

const extractBase64FromArray = (content: any[]): string | null => {
  console.log("Extracting base64 from array with", content.length, "items");
  for (const item of content) {
    console.log("Processing item:", { type: item.type, hasImageUrl: !!item.image_url });
    if (item.type === 'image_url' && item.image_url) {
      const imageUrl = typeof item.image_url === 'string' ? item.image_url : item.image_url.url;
      console.log("Found image URL:", imageUrl?.substring(0, 100) + "...");
      if (imageUrl?.startsWith('data:image/')) {
        const result = extractBase64FromString(imageUrl);
        if (result) {
          console.log("Successfully extracted base64 from array, length:", result.length);
          return result;
        }
      }
    }
  }
  console.log("No base64 data found in array");
  return null;
};

export const isVisionRequest = (payload: PromptPayload): boolean => {
  // Determines if the request should be treated as an OpenAI "vision" request.
  // A vision request contains at least one content item of type "image_url" in
  // the final message of the conversation payload.

  // Validate payload structure
  if (!payload?.messages || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    return false;
  }

  // Focus only on the most-recent (final) message – this is what OpenAI counts
  // when detecting vision requests.
  const finalMessage = payload.messages[payload.messages.length - 1] as any;
  const { content } = finalMessage ?? {};

  // The OpenAI vision format expects the content field to be an array of
  // ContentPart objects. If it's not an array, it cannot be a vision request.
  if (!Array.isArray(content)) {
    return false;
  }

  // Scan each item looking for a valid image_url entry.
  for (const item of content) {
    if (item && typeof item === "object") {
      const itemType = (item as any).type;
      const imageUrl = (item as any).image_url;

      // Accept both string URLs and the `{ url: string }` object shape used in
      // the OpenAI spec. Ensure the value is non-empty.
      const hasValidImageUrl =
        (typeof imageUrl === "string" && imageUrl.trim() !== "") ||
        (typeof imageUrl === "object" && imageUrl?.url && imageUrl.url.trim() !== "");

      if (itemType === "image_url" && hasValidImageUrl) {
        return true;
      }
    }
  }

  return false;
};

const generateImage = async (prompt: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
  
  // Truncate prompts to 1000 characters if needed
  prompt = prompt.slice(0, 1000);

  console.log(`🎨 Starting image generation with model ${IMAGE_GENERATION_MODEL_NAME}`);
  console.log(`📝 Prompt (${prompt.length} chars): '${prompt}'`);

  try {
    console.log(`🔧 Request configuration:`, {
      model: IMAGE_GENERATION_MODEL_ID,
      n: 1
    });

    const startTime = Date.now();
    
    const requestBody = {
      model: IMAGE_GENERATION_MODEL_ID,
      prompt: prompt,
      size: "1024x1024",
      stream: true,
    };
    
    // Make streaming request using fetch
    const response = await fetch(`${LLM_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      return false;
    }

    if (!response.body) {
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = '';
    let imageData = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6); // Remove 'data: ' prefix
          try {
            const parsedData = JSON.parse(data);
            
            // Check if this is the final result with image data
            if (parsedData.image_base64) {
              imageData += parsedData.image_base64;
              if (parsedData.finish_reason === "stop") {
                const imageResultContent = `<img src="data:image/png;base64,${imageData}" />`;
                const finalChunk = enqueueMessage(true, imageResultContent);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
                return true;
              }
            }
            // Check if this is a progress/status update
            else if (parsedData.finish_reason === "error") {
              return false;
            }
          } catch (parseError) {
            console.error('Error parsing streaming data:', parseError);
            return false;
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📡 Streaming completed after ${duration}s`);
    
    return true;

  } catch (error: unknown) {
    console.error(`💥 Unexpected error during image generation:`, error);
    return false;
  }
};


const editImage = async (prompt: string, imageBase64: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
  // Truncate prompts to 1000 characters if needed
  prompt = prompt.slice(0, 1000);

  console.log(`🖼️ Starting image editing with model ${IMAGE_EDITING_MODEL_NAME}`);
  console.log(`📝 Edit prompt (${prompt.length} chars): '${prompt}'`);

  try {
    console.log(`🔧 Request configuration:`, {
      prompt: prompt
    });

    console.log(`⏳ Image editing may take up to 1 hour. Please be patient...`);
    
    const startTime = Date.now();

    const requestBody = {
      model: IMAGE_EDITING_MODEL_ID,
      prompt: prompt.trim(),
      image: imageBase64,
      stream: true
    };

    // Make streaming request using fetch
    const response = await fetch(`${LLM_BASE_URL}/v1/images/edits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      return false;
    }

    if (!response.body) {
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = '';
    let imageData = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6); // Remove 'data: ' prefix
          try {
            const parsedData = JSON.parse(data);
            
            // Check if this is the final result with image data
            if (parsedData.image_base64) {
              imageData += parsedData.image_base64;
              if (parsedData.finish_reason === "stop") {
                const imageResultContent = `<img src="data:image/png;base64,${imageData}" />`;
                const finalChunk = enqueueMessage(true, imageResultContent);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
                return true;
              }
            }
            // Check if this is a progress/status update
            else if (parsedData.finish_reason === "error") {
              return false;
            }

          } catch (parseError) {
            console.error('Error parsing streaming data:', parseError);
            return false;
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📡 Streaming completed after ${duration}s`);
    
    // If we haven't sent final image yet and have image data, send it now
    if (imageData) {
      const imageResultContent = `<img src="data:image/png;base64,${imageData}" />`;
      const finalChunk = enqueueMessage(true, imageResultContent);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      return true;
    }
    
    return true;

  } catch (error: unknown) {
    console.error(`💥 Unexpected error during image editing:`, error);
    return false;
  }
};

const enqueueMessage = (
  stop: boolean,
  content: string
): ChatCompletionChunk => {
  return {
    id: `chatcmpl-${new Date().valueOf()}`,
    object: "chat.completion.chunk",
    created: new Date().getTime(),
    model: MODEL || "unknown",
    choices: [
      {
        index: 0,
        delta: {
          content: content,
        },
        logprobs: null,
        finish_reason: stop ? "stop" : null,
      },
    ],
  };
};

export const prompt = async (
  payload: PromptPayload
): Promise<string | ReadableStream<Uint8Array>> => {
  console.log("Starting prompt with payload:", payload);

  let lastImageData: string | null = null;

  if (!payload.messages?.length) {
    throw new Error("No messages provided in payload");
  }  

  try {
    // Initialize messages with system message and user payload
    return new ReadableStream({
      async start(controller) {
        
        const messages: Array<OpenAI.ChatCompletionMessageParam> = [
          {
            role: "system",
            content: systemPrompt,
          },
          ...(payload.messages as Array<OpenAI.ChatCompletionMessageParam>),
        ];        
        // Search through messages in reverse order to find the most recent image
        // This will override any existing saved image data
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (!message.content) continue;
          if (typeof message.content === 'string') {
            console.log("message.content", message.content);
            lastImageData = extractBase64FromString(message.content);
            if (lastImageData) {
              break;
            }
          } else if (Array.isArray(message.content)) {
            lastImageData = extractBase64FromArray(message.content);
            if (lastImageData) {
              break;
            }
          }        
        }

       const processedMessages = messages.map((message, index) => {
         if (message.content && message.role !== "system") {
           let processedContent: string;
           
           // Handle different content types
           if (typeof message.content === 'string') {
             processedContent = message.content;
           } else if (Array.isArray(message.content)) {
             // Extract text from content array and combine into single string
             // Also include image URL references in a clean format
             processedContent = message.content.map((item: any) => {
               if (typeof item === 'string') {
                 return item;
               } else if (item.type === 'text' && item.text) {
                 return item.text;
               } else if (item.type === 'image_url' && item.image_url && item.image_url.url) {
                 const url = item.image_url.url;
                 if (url.startsWith('data:image/')) {
                   // Extract base64 prefix for clean reference
                   const base64Match = url.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]{1,20})/);
                   if (base64Match && base64Match[1]) {
                     return '';
                   }
                   return '';
                 } else {
                   return '';
                 }
               }
               return '';
             }).filter((text: string) => text.trim()).join(' ');
           } else {
             // Fallback for other content types
             processedContent = String(message.content);
           }
           
          // Check if this message originally contained image data and clean it up
          const originallyHadImage = (typeof message.content === 'string' && message.content.includes('data:image/')) ||
                                   (Array.isArray(message.content) && message.content.some(item => 
                                     item.type === 'image_url' && item.image_url));
          
          // Also check for raw base64 strings (like dummyImage)
          const hasRawBase64 = typeof processedContent === 'string' && /[A-Za-z0-9+/=]{200,}/.test(processedContent);
          
          if ((originallyHadImage || hasRawBase64) && typeof processedContent === 'string') {
            // Apply all patterns multiple times to ensure complete removal
            // Sometimes nested patterns require multiple passes
            for (let i = 0; i < 3; i++) {
              const beforeLength = processedContent.length;
              BASE64_IMAGE_PATTERNS.forEach(pattern => {
                processedContent = processedContent.replace(pattern, (match) => {
                  // Extract the base64 part from the match
                  const base64Match = match.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
                  if (base64Match && base64Match[1]) {
                    return '';
                  }
                  return '';
                });
              });
              if (processedContent.length === beforeLength) break; // nothing left to replace
            }
            // Final cleanup: remove any remaining very long base64-looking strings
            processedContent = processedContent.replace(/[A-Za-z0-9+/=]{200,}/g, (match) => {
              return '';
            });
          }
           return { ...message, content: processedContent };
         }
          return message;
        }) as Array<OpenAI.ChatCompletionMessageParam>;

        if (lastImageData) {
          const lastUserMessageIndex = processedMessages.map((msg, idx) => ({ msg, idx }))
            .filter(({ msg }) => msg.role === 'user')
            .pop()?.idx;

          if (lastUserMessageIndex !== undefined) {
            const lastUserMessage = processedMessages[lastUserMessageIndex];
            if (typeof lastUserMessage.content === 'string') {              
              lastUserMessage.content += '\n\nAn image is provided at `image.png` and available for editing';
            }
          }
        }

        console.log("Processed messages:", processedMessages);
        
        const completion = await openAI.chat.completions.create({
          model: MODEL || "default-model",
          messages: processedMessages,
          temperature: 0.6,
          top_p: 0.95,
          stream: true,
          seed: 42,
          top_k: 20,
          tools: tools
        });
        
        for await (const chunk of completion) {
          if (chunk) {
            const toolCallDelta = (chunk as ChatCompletionChunk).choices[0].delta.tool_calls;
            // const content = (chunk as ChatCompletionChunk).choices[0].delta.content;

            // Safeguard against undefined values that can occur in intermediate streaming chunks
            if (toolCallDelta && toolCallDelta.length > 0) {
              const toolCall = toolCallDelta[0];
              console.log("Tool call:", toolCall);
              if (toolCall?.function?.name === "generate_image") {
                try {
                  const { prompt } = JSON.parse(toolCall?.function?.arguments || "{}");
                  const tool_call_content_action = `<action>Executing <b> ` + (toolCall?.function?.name ?? "generate_image") + ` </b> </action><details><summary>Arguments: ` + (toolCall?.function?.arguments ?? "{}") + `</summary></details>`;
                  console.log("Tool call content action:", tool_call_content_action);
                  // Create chunk for tool execution message
                  const toolExecutionChunk = enqueueMessage(false, tool_call_content_action);
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(toolExecutionChunk)}\n\n`)
                  );
                  
                  // init isSuccess
                  let isSuccess: boolean | undefined = false;

                  for (let i = 0; i < 3; i++) {
                    isSuccess = await generateImage(prompt, controller);
                    if (isSuccess) {
                      console.log("Image generation succeeded");
                      break;
                    }
                    console.log("Image generation failed, retrying...");
                  }
                  if (!isSuccess) {
                    const errorChunk = enqueueMessage(true, `<error>Failed to generate image</error>`);
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
                    );
                  }

                } catch (parseError) {
                  console.error("Error parsing tool call arguments:", parseError);
                  const errorChunk = enqueueMessage(true, `<error>Failed to parse arguments</error>`);
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
                  );
                }
              } else if (toolCall?.function?.name === "edit_image") {
                try {
                  const { prompt } = JSON.parse(toolCall?.function?.arguments || "{}");
                  const tool_call_content_action = `<action>Executing <b> ` + (toolCall?.function?.name ?? "edit_image") + ` </b> </action><details><summary>Arguments: ` + (toolCall?.function?.arguments ?? "{}") + `</summary></details>`;
                  console.log("Tool call content action:", tool_call_content_action);
                  
                  // Create chunk for tool execution message
                  const toolExecutionChunk = enqueueMessage(false, tool_call_content_action);
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(toolExecutionChunk)}\n\n`)
                  );
                  if (!lastImageData) {
                    const errorChunk = enqueueMessage(true, `Please provide an image to edit. You can do this by uploading an image in the messages.`);
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
                    );
                    continue;
                  }
                  
                  // init isSuccess
                  let isSuccess: boolean | undefined = false;

                  for (let i = 0; i < 3; i++) {
                    isSuccess = await editImage(prompt, lastImageData, controller);
                    if (isSuccess) {
                      console.log("Image editing succeeded");
                      break;
                    }
                    console.log("Image editing failed, retrying...");
                  }
                  if (!isSuccess) {
                    const errorChunk = enqueueMessage(true, `<error>Failed to edit image</error>`);
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
                    );
                  }
                } catch (parseError) {
                  console.error("Error parsing tool call arguments:", parseError);
                  const errorChunk = enqueueMessage(true, `<error>Failed to parse arguments</error>`);
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
                  );
                }
              }
            }
            else {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
              );
            }
          }
        }
        controller.close();
      },
    });
  } catch (error) {
    console.error("Error in prompt execution:", error);
    throw new Error(
      `Failed to execute prompt: ${
        error instanceof Error ? error.cause || error.message : "Unknown error"
      }`
    );
  }
};
