import { Probot } from 'probot';
import { NextRequest, NextResponse } from 'next/server';
import probotApp from '../../../src/index';

let probot: Probot | null = null;

function getProbot(): Probot {
  if (!probot) {
    const privateKey = process.env.PRIVATE_KEY!.replace(/\\n/g, '\n');

    probot = new Probot({
      appId: process.env.APP_ID!,
      privateKey,
      secret: process.env.WEBHOOK_SECRET!,
    });
    probot.load(probotApp);
  }
  return probot;
}

export async function GET() {
  return NextResponse.json({ status: 'Severino Poggibonsi is running!' });
}

export async function POST(request: NextRequest) {
  const name = request.headers.get('x-github-event');
  const id = request.headers.get('x-github-delivery');
  const signature = request.headers.get('x-hub-signature-256');

  if (!name || !id) {
    return NextResponse.json(
      { error: 'Missing GitHub webhook headers' },
      { status: 400 }
    );
  }

  try {
    const bot = getProbot();
    const body = await request.text();

    await bot.webhooks.verifyAndReceive({
      id,
      name: name as any,
      payload: body,
      signature: signature || '',
    });

    return NextResponse.json({ status: 'OK' });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
