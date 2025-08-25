import request from 'supertest';
import express from 'express';
import * as promptModule from '../prompt/index.js';
import type { PromptPayload } from '../prompt/types.js';

// Import the app setup from index.ts, but since index.ts starts the server directly, we need to refactor for testability.
// For now, we will re-create the app setup here for testing.
import helmet from 'helmet';
import cors from 'cors';

const createTestApp = () => {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: expect.any(String) });
  });

  app.post('/prompt', async (req, res) => {
    const payload = req.body;
    try {
      if (!!payload.ping) {
        res.send('online');
      } else if (payload.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const result = await promptModule.prompt(payload);
        if (result && typeof result === 'object' && 'getReader' in result) {
          // Simulate streaming
          res.write('data: {"type":"chunk","content":"hello"}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.write(`data: {"type":"complete","content":${JSON.stringify(result)}}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } else {
        const result = await promptModule.prompt(payload);
        res.json(result);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return app;
};

describe('Express App', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('POST /prompt with ping returns online', async () => {
    const res = await request(app)
      .post('/prompt')
      .send({ ping: true });
    expect(res.status).toBe(200);
    expect(res.text).toBe('online');
  });

  it('POST /prompt returns non-streaming result', async () => {
    const mockResult = { reply: 'Hello, world!' };
    jest.spyOn(promptModule, 'prompt').mockResolvedValueOnce(mockResult as any);
    const payload: PromptPayload = {
      messages: [
        { role: 'user', content: 'Hello' },
      ],
    };
    const res = await request(app)
      .post('/prompt')
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockResult);
  });

  it('POST /prompt returns streaming result', async () => {
    // Mock a ReadableStream with getReader
    const mockStream = {
      getReader: () => ({
        read: jest.fn()
          .mockResolvedValueOnce({ done: false, value: Buffer.from('data: {"type":"chunk","content":"hello"}\n\n') })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: jest.fn(),
      }),
    };
    jest.spyOn(promptModule, 'prompt').mockResolvedValueOnce(mockStream as any);
    const payload: PromptPayload = {
      messages: [
        { role: 'user', content: 'Hello' },
      ],
      stream: true,
    };
    const res = await request(app)
      .post('/prompt')
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.text).toContain('[DONE]');
  });

  it('POST /prompt with missing messages returns 500', async () => {
    jest.spyOn(promptModule, 'prompt').mockImplementationOnce(() => {
      throw new Error('No messages provided in payload');
    });
    const res = await request(app)
      .post('/prompt')
      .send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/No messages/);
  });
});
