import { createProbot, createNodeMiddleware } from 'probot';
import type { IncomingMessage, ServerResponse } from 'http';
import app from '../src/index';

const probot = createProbot();
const middleware = createNodeMiddleware(app, { probot, webhooksPath: '/api/webhook' });

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await middleware(req, res);
}
