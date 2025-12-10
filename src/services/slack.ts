import { WebClient } from '@slack/web-api';
import { ILogger, SlackMessage, SlackBlock, UserMapping } from '../types';

export class SlackService {
  private client: WebClient;
  private logger: ILogger;
  private userMapping: UserMapping;

  constructor(botToken: string, logger: ILogger, userMapping: UserMapping = {}) {
    this.client = new WebClient(botToken);
    this.logger = logger;
    this.userMapping = userMapping;
  }

  getSlackUserId(githubUsername: string): string | null {
    return this.userMapping[githubUsername] || null;
  }

  async sendDirectMessage(slackUserId: string, message: SlackMessage): Promise<string | null> {
    this.logger.info('Sending Slack DM', { userId: slackUserId });

    try {
      // Open a conversation with the user
      const conversationResponse = await this.client.conversations.open({
        users: slackUserId,
      });

      if (!conversationResponse.channel?.id) {
        this.logger.error('Failed to open conversation', { userId: slackUserId });
        return null;
      }

      const channelId = conversationResponse.channel.id;

      // Send the message
      const messageResponse = await this.client.chat.postMessage({
        channel: channelId,
        text: message.text,
        blocks: message.blocks,
      });

      return messageResponse.ts || null;
    } catch (error) {
      this.logger.error('Failed to send Slack DM', { error, userId: slackUserId });
      return null;
    }
  }

  async sendBranchDeletionRequest(
    githubUsername: string,
    branchName: string,
    repoFullName: string,
    requestId: string
  ): Promise<string | null> {
    const slackUserId = this.getSlackUserId(githubUsername);

    if (!slackUserId) {
      this.logger.warn('No Slack user mapping found', { githubUsername });
      return null;
    }

    const message = this.createBranchDeletionMessage(branchName, repoFullName, requestId);
    return this.sendDirectMessage(slackUserId, message);
  }

  private createBranchDeletionMessage(branchName: string, repoFullName: string, requestId: string): SlackMessage {
    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Ciao!\n\nI'm *Severino Poggibonsi* from NOTRIVIAL. I noticed branch \`${branchName}\` in \`${repoFullName}\` was merged manually (without a PR) and is still hanging around.\n\nWould you like me to clean it up for you?`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Yes, delete it',
            },
            style: 'primary',
            action_id: 'branch_delete_approve',
            value: requestId,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'No, keep it',
            },
            style: 'danger',
            action_id: 'branch_delete_reject',
            value: requestId,
          },
        ],
      },
    ];

    return {
      channel: '', // Will be set when opening conversation
      text: `Branch cleanup request for ${branchName} in ${repoFullName}`,
      blocks,
    };
  }

  async sendNotification(slackUserId: string, text: string): Promise<boolean> {
    this.logger.info('Sending notification', { userId: slackUserId });

    try {
      const conversationResponse = await this.client.conversations.open({
        users: slackUserId,
      });

      if (!conversationResponse.channel?.id) {
        return false;
      }

      await this.client.chat.postMessage({
        channel: conversationResponse.channel.id,
        text,
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to send notification', { error, userId: slackUserId });
      return false;
    }
  }

  async updateMessage(channelId: string, messageTs: string, text: string, blocks?: SlackBlock[]): Promise<boolean> {
    try {
      await this.client.chat.update({
        channel: channelId,
        ts: messageTs,
        text,
        blocks,
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to update message', { error, channelId, messageTs });
      return false;
    }
  }
}

export function createSlackService(logger: ILogger, userMapping: UserMapping = {}): SlackService {
  const botToken = process.env.SLACK_BOT_TOKEN || '';
  return new SlackService(botToken, logger, userMapping);
}
