import OpenAI from "openai";
import { ChatCompletionChunk } from "openai/resources/chat";

import { PromptPayload } from "./types";
import { MODEL, LLM_API_KEY, SYSTEM_PROMPT, LLM_BASE_URL, IMAGE_GENERATION_MODEL_ID, IMAGE_GENERATION_MODEL_NAME, IMAGE_EDITING_MODEL_NAME, IMAGE_EDITING_MODEL_ID, MAX_RETRIES } from "../constants";
import fs from "fs";

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
        "Invoke this tool ONLY when the user explicitly requests the creation of a new image (trigger words: imagine, generate, create, make, draw, render, or synonyms). \
The request must be transformed into a vivid, cinematic, and richly detailed artistic prompt. Go beyond the subject alone — capture atmosphere, mood, textures, lighting, composition, perspective, and style. \
The final description should feel immersive and sensory, painting a scene with words while remaining true to the user’s intent.",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description":
              "A highly imaginative, magic-enhanced scene description. \
Incorporate stylistic details (art style, medium, genre), sensory qualities (colors, lighting, textures, environment), and mood-setting elements (tone, emotion, ambience) that amplify the user’s vision into an artistic prompt."
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
        "Invoke this tool ONLY when the user explicitly requests modifications to an existing image (trigger words: edit, modify, change, adjust, retouch, or synonyms) AND an image is attached or available from previous output. \
The role of this tool is corrective and directive — apply the edits exactly as instructed by the user, without inventing, embellishing, or adding unrequested details. \
Stay precise, faithful, and literal in carrying out the modification.",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description":
              "The user’s edit instructions, preserved faithfully and translated into clear directives. \
If sensitive terms are used (e.g., 'nude', 'naked'), rewrite them into explicit but unambiguous edit commands (e.g., 'remove clothing') while preserving intent. \
Ensure the instructions remain specific, actionable, and free of additional creativity beyond the user’s request."
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
      console.error(`🚫 Image generation API error: ${response.status} ${response.statusText}`);
      const errorText = await response.text().catch(() => 'Unknown error');
      const errorChunk = enqueueMessage(true, `<error>Image generation failed: ${response.status} ${response.statusText}. ${errorText}</error>`);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
      return false;
    }

    if (!response.body) {
      console.error('🚫 No response body received from image generation API');
      const errorChunk = enqueueMessage(true, `<error>Image generation failed: No response body received from API</error>`);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = '';
    let hasReceivedImage = false;
    let imageBase64Data = '';

    try {
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
            // Handle the [DONE] message that signals end of stream
            if (data.trim() === '[DONE]') {
              console.log('📡 Received [DONE] signal, ending stream');
              break;
            }
            
            try {
              const parsedData = JSON.parse(data);
              
              // Check if this is the final result with image data
              if (parsedData.image_base64) {
                imageBase64Data += parsedData.image_base64;
                if (parsedData.finish_reason === "stop") {
                  imageBase64Data = "<img src=\"data:image/png;base64," + imageBase64Data + "\" />";
                  const chunkImageData = enqueueMessage(false, imageBase64Data);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkImageData)}\n\n`));
                  hasReceivedImage = true;
                }
              }
              // Check if this is a progress/status update
              else if (parsedData.finish_reason === "error") {
                console.error('🚫 Image generation failed with error finish_reason');
                const errorMsg = parsedData.error || 'Unknown error during image generation';
                const errorChunk = enqueueMessage(true, `<error>Image generation failed: ${errorMsg}</error>`);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
                return false;
              }
            } catch (parseError) {
              console.error('🚫 Error parsing streaming data:', parseError);
              const errorChunk = enqueueMessage(true, `<error>Image generation failed: Error parsing response data</error>`);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
              return false;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📡 Streaming completed after ${duration}s`);
    
    return hasReceivedImage;

  } catch (error: unknown) {
    console.error(`💥 Unexpected error during image generation:`, error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const errorChunk = enqueueMessage(true, `<error>Image generation failed: ${errorMsg}</error>`);
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
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
      console.error(`🚫 Image editing API error: ${response.status} ${response.statusText}`);
      const errorText = await response.text().catch(() => 'Unknown error');
      const errorChunk = enqueueMessage(true, `<error>Image editing failed: ${response.status} ${response.statusText}. ${errorText}</error>`);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
      return false;
    }

    if (!response.body) {
      console.error('🚫 No response body received from image editing API');
      const errorChunk = enqueueMessage(true, `<error>Image editing failed: No response body received from API</error>`);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = '';
    // let firstChunk = true;
    let hasReceivedImage = false;
    let imageBase64Data = '';

    try {
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
            // Handle the [DONE] message that signals end of stream
            if (data.trim() === '[DONE]') {
              console.log('📡 Received [DONE] signal, ending stream');
              break;
            }
            
            try {
              const parsedData = JSON.parse(data);
              
              // Check if this is the final result with image data
              if (parsedData.image_base64) {
                imageBase64Data += parsedData.image_base64;
                if (parsedData.finish_reason === "stop") {
                  imageBase64Data = "<img src=\"data:image/png;base64," + imageBase64Data + "\" />";
                  const chunkImageData = enqueueMessage(false, imageBase64Data);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkImageData)}\n\n`));
                  hasReceivedImage = true;
                }
              }
              // Check if this is a progress/status update
              else if (parsedData.finish_reason === "error") {
                console.error('🚫 Image editing failed with error finish_reason');
                const errorMsg = parsedData.error || 'Unknown error during image editing';
                const errorChunk = enqueueMessage(true, `<error>Image editing failed: ${errorMsg}</error>`);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
                return false;
              }
            } catch (parseError) {
              console.error('🚫 Error parsing streaming data:', parseError);
              const errorChunk = enqueueMessage(true, `<error>Image editing failed: Error parsing response data</error>`);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
              return false;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📡 Streaming completed after ${duration}s`);
    
    return hasReceivedImage;

  } catch (error: unknown) {
    console.error(`💥 Unexpected error during image editing:`, error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const errorChunk = enqueueMessage(true, `<error>Image editing failed: ${errorMsg}</error>`);
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
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

  // load dummy image from file
  // const dummyImage = fs.readFileSync("i2v_input.JPG", 'base64');

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
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          if (!message.content) continue;
          
          if (typeof message.content === 'string') {
            // Use existing BASE64_IMAGE_PATTERNS for comprehensive detection
            let imageCounter = 0;
            for (const pattern of BASE64_IMAGE_PATTERNS) {
              message.content = message.content.replace(pattern, (match) => {
                // Extract base64 data from the match
                const base64Data = extractBase64FromString(match);
                if (base64Data) {
                  const imageType = message.role === 'assistant' ? 'generated' : 'attached';
                  const filename = `${i}_${imageType}_${imageCounter}.png`;
                  imageCounter++;
                  
                  // Save the base64 image to file
                  try {
                    const buffer = Buffer.from(base64Data, 'base64');
                    fs.writeFileSync(filename, buffer);
                    console.log(`💾 Saved ${imageType} image: ${filename}`);
                  } catch (error) {
                    console.error(`❌ Failed to save ${imageType} image ${filename}:`, error);
                  }
                  
                  return `The image ${imageType} at ${filename}.`;
                }
                return match; // Return original if extraction failed
              });
            }
            
            // Handle raw base64 strings (100+ chars to avoid false positives)
            if (/^[A-Za-z0-9+/=]{100,}$/.test(message.content.trim())) {
              const base64Data = message.content.trim();
              const imageType = message.role === 'assistant' ? 'generated' : 'attached';
              const filename = `${i}_${imageType}.png`;
              
              // Save the base64 image to file
              try {
                const buffer = Buffer.from(base64Data, 'base64');
                fs.writeFileSync(filename, buffer);
                console.log(`💾 Saved ${imageType} image: ${filename}`);
                message.content = `The image ${imageType} at ${filename}.`;
              } catch (error) {
                console.error(`❌ Failed to save ${imageType} image ${filename}:`, error);
              }
            }
          } else if (Array.isArray(message.content)) {
            // Handle array content (vision request format) - convert to string
            let stringContent = '';
            let imageCounter = 0;
            
            for (let j = 0; j < message.content.length; j++) {
              const item = message.content[j];
              if (item && typeof item === 'object') {
                if (item.type === 'text') {
                  stringContent += (item as any).text;
                } else if (item.type === 'image_url') {
                  const imageUrl = typeof item.image_url === 'string' ? item.image_url : item.image_url?.url;
                  if (imageUrl && imageUrl.startsWith('data:image/')) {
                    const base64Match = imageUrl.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
                    if (base64Match) {
                      const base64Data = base64Match[1];
                      const imageType = message.role === 'assistant' ? 'generated' : 'attached';
                      const filename = `${i}_${imageType}_${imageCounter}.png`;
                      imageCounter++;
                      
                      // Save the base64 image to file
                      try {
                        const buffer = Buffer.from(base64Data, 'base64');
                        fs.writeFileSync(filename, buffer);
                        console.log(`💾 Saved ${imageType} image: ${filename}`);
                      } catch (error) {
                        console.error(`❌ Failed to save ${imageType} image ${filename}:`, error);
                      }
                      
                      // Add descriptive text to string content
                      const imageDescription = `The image ${imageType} at ${filename}.\n`;
                      stringContent += (stringContent ? '\n' : '') + imageDescription;
                    }
                  } else {
                    // Handle non-data URL images
                    stringContent += (stringContent ? ' ' : '') + `[Image: ${imageUrl}]`;
                  }
                }
              }
            }
            
            // Convert array content to string
            message.content = stringContent;
          }
        }

        const lastUserMessageIndex = messages.map((msg, idx) => ({ msg, idx }))
            .filter(({ msg }) => msg.role === 'user')
            .pop()?.idx;
        if (lastUserMessageIndex !== undefined) {
          const lastUserMessage = messages[lastUserMessageIndex];
          if (typeof lastUserMessage.content === 'string') {
            lastUserMessage.content = "You must use extremely long chains of thought to deeply consider the problem and deliberate with yourself via systematic reasoning processes to help come to a correct solution prior to answering. You should enclose your thoughts and internal monologue inside <think> </think> tags, and then provide your solution or response to the problem.\n" + lastUserMessage.content;
          }
        }

        console.log("Messages:", messages);
        
        // Retry the entire completion request if tool call parsing fails
        let completionRetryCount = 0;
        let completionSuccessful = false;
        
        while (completionRetryCount < MAX_RETRIES && !completionSuccessful) {
          try {
            if (completionRetryCount > 0) {
              console.log(`🔄 Retrying completion request (attempt ${completionRetryCount + 1}/${MAX_RETRIES})`);
              const retryChunk = enqueueMessage(false, `<info>Retrying request due to parsing error (attempt ${completionRetryCount + 1}/${MAX_RETRIES})</info>`);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(retryChunk)}\n\n`)
              );
            }
            
            const completion = await openAI.chat.completions.create({
              model: MODEL || "default-model",
              messages: messages,
              temperature: 0.6,
              top_p: 0.95,
              stream: true,
              seed: 42,
              tools: tools
            });
            
            let hasParsingError = false;
            
            for await (const chunk of completion) {
              if (chunk) {            
                const toolCallDelta = (chunk as ChatCompletionChunk).choices[0].delta.tool_calls;
                // const content = (chunk as ChatCompletionChunk).choices[0].delta.content;

                // Safeguard against undefined values that can occur in intermediate streaming chunks
                if (toolCallDelta && toolCallDelta.length > 0) {
                  const toolCall = toolCallDelta[0];
                  if (toolCall?.function?.name === "generate_image") {
                    try {
                      const { prompt } = JSON.parse(toolCall?.function?.arguments || "{}");
                      const tool_call_content_action = `<action>Executing <b> ` + (toolCall?.function?.name ?? "generate_image") + ` </b> </action><details><summary>Arguments: ` + (toolCall?.function?.arguments ?? "{}") + `</summary></details>`;
                      // Create chunk for tool execution message
                      const toolExecutionChunk = enqueueMessage(false, tool_call_content_action);
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify(toolExecutionChunk)}\n\n`)
                      );
                      
                      // init isSuccess
                      let isSuccess: boolean | undefined = false;

                      for (let i = 0; i < MAX_RETRIES; i++) {
                        isSuccess = await generateImage(prompt, controller);
                        if (isSuccess) {
                          break;
                        }
                      }
                      
                      if (!isSuccess) {
                        const errorChunk = enqueueMessage(true, `<error>Failed to generate image</error>`);
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
                        );
                      }

                    } catch (parseError) {
                      console.error(`Error parsing tool call arguments (attempt ${completionRetryCount + 1}):`, parseError);
                      hasParsingError = true;
                      break; // Exit the chunk processing loop to retry the entire completion
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

                      for (let i = 0; i < MAX_RETRIES; i++) {
                        isSuccess = await editImage(prompt, lastImageData, controller);
                        if (isSuccess) {
                          break;
                        }
                      }

                      if (!isSuccess) {
                        const errorChunk = enqueueMessage(true, `<error>Failed to edit image</error>`);
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
                        );
                      }
                    } catch (parseError) {
                      console.error(`Error parsing tool call arguments (attempt ${completionRetryCount + 1}):`, parseError);
                      hasParsingError = true;
                      break; // Exit the chunk processing loop to retry the entire completion
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
            
            // If we got through all chunks without parsing errors, mark as successful
            if (!hasParsingError) {
              completionSuccessful = true;
            } else {
              completionRetryCount++;
            }
            
          } catch (completionError) {
            console.error(`Error in completion request (attempt ${completionRetryCount + 1}):`, completionError);
            completionRetryCount++;
            
            if (completionRetryCount >= MAX_RETRIES) {
              const errorChunk = enqueueMessage(true, `<error>Failed to complete request after ${MAX_RETRIES} attempts</error>`);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
              );
            }
          }
        }
        
        // If we exhausted all retries due to parsing errors
        if (!completionSuccessful && completionRetryCount >= MAX_RETRIES) {
          const errorChunk = enqueueMessage(true, `<error>Failed to parse tool call arguments after ${MAX_RETRIES} attempts</error>`);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
          );
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
