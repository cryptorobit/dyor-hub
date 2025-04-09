import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Context, Telegraf } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';
import { Repository } from 'typeorm';
import { TelegramUserConnectionEntity } from '../../entities/telegram-user-connection.entity';

@Injectable()
export class TelegramUserService implements OnModuleInit {
  private readonly logger = new Logger(TelegramUserService.name);
  bot: Telegraf<Context>;
  private enabled = false;
  private readonly defaultAppUrl: string;
  private webhookUrl: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(TelegramUserConnectionEntity)
    private readonly telegramUserRepository: Repository<TelegramUserConnectionEntity>,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.defaultAppUrl =
      this.configService.get<string>('DEFAULT_APP_URL') || '';
    this.webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');

    if (!token) {
      this.logger.warn(
        'User Telegram notifications disabled. Set TELEGRAM_BOT_TOKEN in .env to enable.',
      );
      this.enabled = false;
      return;
    }

    if (!this.webhookUrl) {
      this.logger.warn(
        'TELEGRAM_WEBHOOK_URL not set. Telegram bot updates via webhook will not work.',
      );
      this.enabled = false;
      return;
    }

    try {
      this.bot = new Telegraf<Context>(token);
      this.setupBotCommands();
    } catch (error) {
      this.logger.error('Failed to initialize Telegram bot instance', error);
      this.enabled = false;
    }
  }

  async onModuleInit() {
    if (!this.bot || !this.webhookUrl) {
      this.logger.warn(
        'Skipping webhook setup in onModuleInit (bot/URL not ready).',
      );
      return;
    }

    const webhookPath = '/telegram/webhook';
    const fullWebhookUrl = `${this.webhookUrl}${webhookPath}`;

    try {
      this.logger.log(`Attempting to set webhook to: ${fullWebhookUrl}`);
      const success = await this.bot.telegram.setWebhook(fullWebhookUrl);

      if (success) {
        this.logger.log(`Telegram webhook set successfully: ${fullWebhookUrl}`);
        this.enabled = true;
      } else {
        this.logger.error(`Failed to set Telegram webhook: ${fullWebhookUrl}`);
        this.enabled = false;
      }
    } catch (error) {
      this.logger.error(
        `Error during webhook setup process in onModuleInit (URL: ${fullWebhookUrl})`,
        error,
      );
      this.enabled = false;
    }
  }

  async handleWebhookUpdate(update: Update): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      await this.bot.handleUpdate(update);
    } catch (error) {
      this.logger.error('Error handling Telegram update via webhook', error);
    }
  }

  private setupBotCommands() {
    if (!this.bot) return;

    this.bot.start(async (ctx) => {
      const payload = ctx.payload;
      if (payload && payload.startsWith('connect_')) {
        const token = payload.substring('connect_'.length);
        this.logger.log(`Deep link /start command with token: ${token}`);
        if (ctx.message) {
          await this.processConnectionToken(ctx, token);
        }
      } else {
        this.logger.log(
          `Received /start command from chat ID: ${ctx.chat?.id}`,
        );
        await this.sendWelcomeMessage(ctx);
      }
    });

    this.bot.command('connect', async (ctx) => {
      this.logger.log(
        `Received /connect command from chat ID: ${ctx.chat?.id}`,
      );
      const text = ctx.message?.text;
      const match = text?.match(/^\/connect(?:@\w+)?\s+(.+)$/);
      if (match && match[1]) {
        const token = match[1].trim();
        await this.processConnectionToken(ctx, token);
      } else {
        await ctx.reply(
          'Please provide a connection token after the /connect command. Example: /connect YOUR_TOKEN',
        );
      }
    });

    this.bot.command('disconnect', async (ctx) => {
      this.logger.log(
        `Received /disconnect command from chat ID: ${ctx.chat?.id}`,
      );
      await this.handleDisconnectCommand(ctx);
    });

    this.bot.command('status', async (ctx) => {
      this.logger.log(`Received /status command from chat ID: ${ctx.chat?.id}`);
      await this.handleStatusCommand(ctx);
    });

    this.bot.command('help', async (ctx) => {
      this.logger.log(`Received /help command from chat ID: ${ctx.chat?.id}`);
      await this.handleHelpCommand(ctx);
    });
  }

  private async handleDisconnectCommand(ctx: Context) {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) {
      this.logger.warn('Disconnect command received without chat ID');
      return;
    }

    try {
      const connection = await this.telegramUserRepository.findOne({
        where: { telegramChatId: chatId },
      });

      if (!connection) {
        this.logger.log(`No connection found for chat ID: ${chatId}`);
        await ctx.reply(
          'No connected account found. Use /connect [token] to connect your DYOR Hub account.',
        );
        return;
      }

      await this.telegramUserRepository.remove(connection);

      await ctx.reply(
        '🔄 Your DYOR Hub account has been disconnected from this Telegram account.',
      );
    } catch (error) {
      this.logger.error(
        `Failed to disconnect Telegram account: ${error.message}`,
        error,
      );
      await ctx.reply(
        'Sorry, there was an error disconnecting your account. Please try again later.',
      );
    }
  }

  private async handleStatusCommand(ctx: Context) {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) {
      this.logger.warn('Status command received without chat ID');
      return;
    }

    try {
      const connection = await this.telegramUserRepository.findOne({
        where: { telegramChatId: chatId },
        relations: ['user'],
      });

      if (!connection) {
        this.logger.log(`No connection found for chat ID: ${chatId}`);
        await ctx.reply(
          'ℹ️ Status: Not connected\n\nUse /connect [token] to connect your DYOR Hub account.',
        );
        return;
      }

      await ctx.reply(
        `✅ Status: Connected\n\n` +
          `Connected to: ${connection.user.displayName}\n` +
          `Connected since: ${connection.createdAt.toLocaleDateString()}\n\n` +
          `Use /disconnect to disconnect this bot from your DYOR hub account.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to check Telegram connection status: ${error.message}`,
        error,
      );
      await ctx.reply(
        'Sorry, there was an error checking your connection status. Please try again later.',
      );
    }
  }

  private async handleHelpCommand(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      this.logger.warn('Help command received without chat ID');
      return;
    }

    try {
      await ctx.replyWithHTML(
        `🔹 <b>Available Commands</b> 🔹\n\n` +
          `/start - Start the bot and get connection info\n` +
          `/connect [token] - Connect your DYOR Hub account using a token\n` +
          `/disconnect - Disconnect your DYOR Hub account\n` +
          `/status - Check your connection status\n` +
          `/help - Show this help message\n\n` +
          `To receive notifications, make sure you've enabled Telegram notifications in your DYOR Hub notification settings.`,
      );
    } catch (error) {
      this.logger.error(`Failed to send help message: ${error.message}`, error);
      await ctx.reply(
        'Sorry, there was an error sending the help message. Please try again later.',
      );
    }
  }

  async generateConnectionToken(userId: string): Promise<string> {
    try {
      let connection = await this.telegramUserRepository.findOne({
        where: { userId },
      });

      const token = randomBytes(16).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      if (connection) {
        connection.connectionToken = token;
        connection.tokenExpiresAt = expiresAt;
        connection.connectionStatus = 'pending';
        connection.telegramChatId = null;
        connection.telegramUsername = null;
        connection.telegramFirstName = null;
      } else {
        connection = this.telegramUserRepository.create({
          userId,
          connectionToken: token,
          tokenExpiresAt: expiresAt,
          connectionStatus: 'pending',
          telegramChatId: null,
        });
      }

      await this.telegramUserRepository.save(connection);
      return token;
    } catch (error) {
      this.logger.error(
        `Failed to generate connection token for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  async hasActiveConnection(userId: string): Promise<boolean> {
    try {
      const connection = await this.telegramUserRepository.findOne({
        where: {
          userId,
          connectionStatus: 'active',
        },
      });
      return !!connection;
    } catch (error) {
      this.logger.error(
        `Failed to check connection status for user ${userId}`,
        error,
      );
      return false;
    }
  }

  async getUserConnection(
    userId: string,
  ): Promise<TelegramUserConnectionEntity | null> {
    try {
      return await this.telegramUserRepository.findOne({
        where: { userId },
      });
    } catch (error) {
      this.logger.error(`Failed to get connection for user ${userId}`, error);
      return null;
    }
  }

  async disconnectUser(userId: string): Promise<boolean> {
    try {
      const connection = await this.telegramUserRepository.findOne({
        where: { userId },
      });

      if (connection) {
        await this.telegramUserRepository.remove(connection);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to disconnect user ${userId}`, error);
      return false;
    }
  }

  async sendNotificationToUser(
    userId: string,
    message: string,
    inlineKeyboard?: any,
  ): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const connection = await this.telegramUserRepository.findOne({
        where: {
          userId,
          connectionStatus: 'active',
        },
      });

      if (!connection || !connection.telegramChatId) {
        return false;
      }

      await this.bot.telegram.sendMessage(connection.telegramChatId, message, {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send Telegram notification to user ${userId}`,
        error,
      );
      return false;
    }
  }

  private async processConnectionToken(ctx: Context, token: string) {
    this.logger.log(`Processing connection with token: ${token}`);
    const chatId = ctx.chat?.id;
    const chat = ctx.chat;

    if (!chatId || !chat) {
      this.logger.error(
        'processConnectionToken called without valid chat context',
      );
      return;
    }

    try {
      const connection = await this.telegramUserRepository.findOne({
        where: { connectionToken: token },
      });

      if (!connection) {
        this.logger.warn(`No connection found for token: ${token}`);
        await ctx.reply(
          'Invalid or expired connection token. Please generate a new token from your DYOR Hub notification settings.',
        );
        return;
      }

      if (connection.tokenExpiresAt && new Date() > connection.tokenExpiresAt) {
        await ctx.reply(
          'Your connection token has expired. Please generate a new token from your DYOR Hub notification settings.',
        );
        return;
      }

      connection.telegramChatId = chatId.toString();
      connection.telegramUsername =
        'username' in chat ? chat.username || null : null;
      connection.telegramFirstName =
        'first_name' in chat ? chat.first_name || null : null;
      connection.connectionStatus = 'active';
      connection.connectionToken = null;
      connection.tokenExpiresAt = null;

      await this.telegramUserRepository.save(connection);

      await ctx.reply(
        '✅ Your DYOR hub account is now connected! You will receive notifications based on your preferences.',
      );
    } catch (error) {
      this.logger.error(
        'Failed to connect Telegram account through deep link',
        error,
      );
      await ctx.reply(
        'Sorry, there was an error connecting your account. Please try again later.',
      );
    }
  }

  private async sendWelcomeMessage(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      this.logger.warn('Welcome message requested without chat ID');
      return;
    }
    await ctx.replyWithHTML(
      `👋 Welcome to the DYOR Hub Notification Bot!\n\n` +
        `To connect this bot to your DYOR Hub account, visit your notification settings page and click the "Connect Telegram" button.\n\n` +
        `Once connected, you'll receive notifications here based on your preferences.`,
    );
  }
}
