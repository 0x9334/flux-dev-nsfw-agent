# Personal AI Agent

This example demonstrates how to set up and use a personal AI agent. You can customize and extend it for tasks like automation or productivity.

## Requirements

- [Node.js](https://nodejs.org/) (version 16 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/eternalai-org/agent-dev-guide.git
   cd agent-dev-guide/examples/personal-agent
   ```

2. Install dependencies:

   ```bash
   npm install
   # or
   yarn install
   ```

## Usage

To start the agent in development mode:

```bash
npm run dev
# or
yarn dev
```

## Customizing the Agent

You can change how the agent behaves by editing the `system-prompt.txt` file. This file contains instructions that guide the agent's responses.

### Updating the System Prompt

1. Open `system-prompt.txt` and add your custom instructions. For example:

   ```
   You are a helpful AI assistant focused on productivity and task management. Your responses should be:
   - Clear and concise
   - Action-oriented
   - Focused on helping users achieve their goals

   When responding to users:
   1. Understand their needs and goals
   2. Provide specific, actionable advice
   3. Break down complex tasks into manageable steps
   4. Follow up to ensure understanding
   ```

2. The agent will automatically use these instructions when processing requests.

You can also set the system prompt using the `SYSTEM_PROMPT` environment variable.

## Example API Call

You can interact with the agent using a simple API call:

```bash
curl --location 'http://localhost:4000/prompt' \
--header 'Content-Type: application/json' \
--data '{
  "messages": [
    {
      "role": "user",
      "content": "Edit this image to make it more erotic"
    }
  ]
}'
```

## Available Commands

- `npm run dev` — Start the agent in development mode
- `npm run start` — Start the agent in production mode

---

**Note:**

- Keep the `PORT` and `LLM_BASE_URL` environment variables. They are required by the platform.
- Replace any placeholder values and add details based on your agent setup.
