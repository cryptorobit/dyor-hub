import { TokenHolder, TokenStats } from '@dyor-hub/types';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TokenEntity } from '../entities/token.entity';
import { WatchlistService } from '../watchlist/watchlist.service';
import { TwitterHistoryService } from './twitter-history.service';

interface BirdeyeTokenOverviewExtensions {
  coingeckoId?: string | null;
  serumV3Usdc?: string | null;
  serumV3Usdt?: string | null;
  website?: string | null;
  telegram?: string | null;
  twitter?: string | null;
  description?: string | null;
  discord?: string | null;
  medium?: string | null;
  [key: string]: any;
}

interface BirdeyeTokenOverviewData {
  address?: string;
  decimals?: number;
  symbol?: string;
  name?: string;
  extensions?: BirdeyeTokenOverviewExtensions;
  logoURI?: string;
  liquidity?: number;
  lastTradeUnixTime?: number;
  price?: number;
  priceChange24hPercent?: number;
  totalSupply?: number;
  fdv?: number;
  marketCap?: number;
  circulatingSupply?: number;
  holder?: number;
  v24hUSD?: number;
  [key: string]: any;
}

interface BirdeyeTokenOverviewResponse {
  data?: BirdeyeTokenOverviewData;
  success?: boolean;
}

interface BirdeyeV3HolderItem {
  amount: string;
  decimals: number;
  mint: string;
  owner: string;
  token_account: string;
  ui_amount: number;
}

interface BirdeyeV3HolderResponse {
  data?: {
    items?: BirdeyeV3HolderItem[];
  };
  success?: boolean;
}

interface DexScreenerTokenPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  info?: {
    imageUrl?: string;
    websites?: Array<{
      label?: string;
      url: string;
    }>;
    socials?: Array<{
      type?: string;
      url?: string;
      platform?: string;
      handle?: string;
    }>;
  };
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly tokenOverviewCache: Map<string, any> = new Map();
  private readonly topHoldersCache: Map<string, any> = new Map();
  private readonly pendingRequests: Map<string, Promise<any>> = new Map();
  private readonly cacheTimestamps: Map<string, number> = new Map();
  private readonly dexScreenerCache: Map<string, any> = new Map();

  constructor(
    @InjectRepository(TokenEntity)
    private readonly tokenRepository: Repository<TokenEntity>,
    private readonly configService: ConfigService,
    private readonly twitterHistoryService: TwitterHistoryService,
    private readonly watchlistService?: WatchlistService,
  ) {}

  /**
   * Fetches Birdeye Token Overview with caching
   */
  public async fetchTokenOverview(
    mintAddress: string,
  ): Promise<BirdeyeTokenOverviewResponse['data'] | null> {
    const cacheKey = `token_overview_${mintAddress}`;
    const cachedData = this.tokenOverviewCache.get(cacheKey);
    const cachedTimestamp = this.cacheTimestamps.get(cacheKey);
    const BIRD_CACHE_TTL = 60 * 1000;

    if (
      cachedData &&
      cachedTimestamp &&
      Date.now() - cachedTimestamp < BIRD_CACHE_TTL
    ) {
      return cachedData;
    }

    // Request Deduplication
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    const requestPromise = (async () => {
      const apiUrl = `https://public-api.birdeye.so/defi/token_overview?address=${mintAddress}`;

      try {
        const response = await fetch(apiUrl, {
          headers: {
            'X-API-KEY': this.configService.get('BIRDEYE_API_KEY') || '',
            'x-chain': 'solana',
          },
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ message: 'Failed to parse error JSON' }));
          const errorMessage = errorData?.message || response.statusText;
          throw new Error(
            `Birdeye API error (${response.status}): ${errorMessage}`,
          );
        }

        const data: BirdeyeTokenOverviewResponse = await response.json();

        if (!data?.success || !data?.data) {
          this.logger.warn(
            `Birdeye overview response unsuccessful or missing data for ${mintAddress}`,
          );
          return null;
        }

        // Cache the data.data part
        this.tokenOverviewCache.set(cacheKey, data.data);
        this.cacheTimestamps.set(cacheKey, Date.now());

        return data.data;
      } catch (error) {
        this.logger.error(
          `Error fetching Birdeye token overview for ${mintAddress}:`,
          error.message,
        );
        return null; // Return null on error
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Fetches token data from DexScreener to update social links
   */
  private async fetchDexScreenerData(
    mintAddress: string,
  ): Promise<DexScreenerTokenPair[] | null> {
    const cacheKey = `dexscreener_${mintAddress}`;
    const cachedData = this.dexScreenerCache.get(cacheKey);
    const cachedTimestamp = this.cacheTimestamps.get(cacheKey);
    const DEXSCREENER_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

    if (
      cachedData &&
      cachedTimestamp &&
      Date.now() - cachedTimestamp < DEXSCREENER_CACHE_TTL
    ) {
      return cachedData;
    }

    // Request Deduplication
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    const requestPromise = (async () => {
      const apiUrl = `https://api.dexscreener.com/tokens/v1/solana/${mintAddress}`;

      try {
        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error(
            `DexScreener API error (${response.status}): ${response.statusText}`,
          );
        }

        const data: DexScreenerTokenPair[] = await response.json();

        if (!data || !Array.isArray(data) || data.length === 0) {
          this.logger.warn(
            `DexScreener response unsuccessful or missing data for ${mintAddress}`,
          );
          return null;
        }

        // Cache the data
        this.dexScreenerCache.set(cacheKey, data);
        this.cacheTimestamps.set(cacheKey, Date.now());

        return data;
      } catch (error) {
        this.logger.error(
          `Error fetching DexScreener data for ${mintAddress}:`,
          error.message,
        );
        return null;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Updates token social links from DexScreener if they've changed
   */
  private async updateTokenSocialLinksFromDexScreener(
    token: TokenEntity,
  ): Promise<TokenEntity> {
    try {
      const dexScreenerData = await this.fetchDexScreenerData(
        token.mintAddress,
      );

      if (!dexScreenerData || dexScreenerData.length === 0) {
        return token;
      }

      // Use the first pair with info data
      const pairWithInfo = dexScreenerData.find((pair) => pair.info);
      if (!pairWithInfo || !pairWithInfo.info) {
        return token;
      }

      let updated = false;
      const updates: Partial<TokenEntity> = {};

      // Check for website URL
      if (pairWithInfo.info.websites && pairWithInfo.info.websites.length > 0) {
        const websiteUrl = pairWithInfo.info.websites[0]?.url;
        if (websiteUrl && token.websiteUrl !== websiteUrl) {
          this.logger.log(
            `Updating website URL for ${token.mintAddress} from ${token.websiteUrl || 'none'} to ${websiteUrl}`,
          );
          updates.websiteUrl = websiteUrl;
          updated = true;
        }
      }

      // Check for social links
      if (pairWithInfo.info.socials && pairWithInfo.info.socials.length > 0) {
        // Find Twitter handle - support both formats (platform and type fields)
        const twitterInfo = pairWithInfo.info.socials.find(
          (s) =>
            (s.platform &&
              (s.platform.toLowerCase() === 'twitter' ||
                s.platform.toLowerCase() === 'x')) ||
            (s.type && s.type.toLowerCase() === 'twitter') ||
            (s.url &&
              (s.url.includes('twitter.com') || s.url.includes('x.com'))),
        );

        if (twitterInfo) {
          let twitterHandle = '';

          // Handle the case where we have either handle or url
          if (twitterInfo.handle) {
            twitterHandle = twitterInfo.handle;
          } else if (twitterInfo.url) {
            // Extract handle from URL
            twitterHandle = twitterInfo.url
              .replace('https://x.com/', '')
              .replace('https://twitter.com/', '')
              .replace('@', '');
          }

          if (twitterHandle && token.twitterHandle !== twitterHandle) {
            this.logger.log(
              `Updating Twitter handle for ${token.mintAddress} from ${token.twitterHandle || 'none'} to ${twitterHandle}`,
            );
            updates.twitterHandle = twitterHandle;
            updated = true;
          }
        }

        // Find Telegram URL
        const telegramInfo = pairWithInfo.info.socials.find(
          (s) =>
            (s.platform && s.platform.toLowerCase() === 'telegram') ||
            (s.type && s.type.toLowerCase() === 'telegram') ||
            (s.url && s.url.includes('t.me')),
        );

        if (telegramInfo) {
          let telegramUrl = '';

          if (telegramInfo.handle) {
            telegramUrl = telegramInfo.handle;
          } else if (telegramInfo.url) {
            telegramUrl = telegramInfo.url;
          }

          if (!telegramUrl.startsWith('https://')) {
            telegramUrl = `https://t.me/${telegramUrl.replace('@', '')}`;
          }

          if (telegramUrl && token.telegramUrl !== telegramUrl) {
            this.logger.log(
              `Updating Telegram URL for ${token.mintAddress} from ${token.telegramUrl || 'none'} to ${telegramUrl}`,
            );
            updates.telegramUrl = telegramUrl;
            updated = true;
          }
        }
      }

      // Update token entity if changes were found
      if (updated) {
        try {
          Object.assign(token, updates);
          await this.tokenRepository.save(token);

          // If Twitter handle was updated, fetch and store username history
          if (updates.twitterHandle) {
            await this.twitterHistoryService
              .fetchAndStoreUsernameHistory(token)
              .catch((error) => {
                this.logger.error(
                  `Error fetching Twitter history for ${token.mintAddress}:`,
                  error,
                );
              });
          }
        } catch (saveError) {
          this.logger.error(
            `Error saving updated token data for ${token.mintAddress}:`,
            saveError,
          );
          return (
            (await this.tokenRepository.findOne({
              where: { mintAddress: token.mintAddress },
            })) || token
          );
        }
      }

      return token;
    } catch (error) {
      this.logger.error(
        `Error updating token social links for ${token.mintAddress}:`,
        error,
      );
      return token;
    }
  }

  async getTokenData(
    mintAddress: string,
    userId?: string,
  ): Promise<TokenEntity & { isWatchlisted?: boolean }> {
    try {
      let token = await this.tokenRepository.findOne({
        where: { mintAddress },
      });

      if (!token) {
        const overviewData = await this.fetchTokenOverview(mintAddress);

        if (!overviewData || (!overviewData.name && !overviewData.symbol)) {
          throw new NotFoundException(
            `Token ${mintAddress} not found via Birdeye overview or missing essential info.`,
          );
        }

        let twitterHandle = null;
        if (overviewData.extensions?.twitter) {
          twitterHandle = overviewData.extensions.twitter
            .replace('https://x.com/', '')
            .replace('https://twitter.com/', '')
            .replace('@', '');
        }

        const baseTokenData: Partial<TokenEntity> = {
          mintAddress: overviewData.address || mintAddress,
          name: overviewData.name,
          symbol: overviewData.symbol,
          description: overviewData.extensions?.description,
          imageUrl: overviewData.logoURI,
          websiteUrl: overviewData.extensions?.website,
          telegramUrl: overviewData.extensions?.telegram,
          twitterHandle: twitterHandle,
          viewsCount: 1, // First view
        };

        const newToken = this.tokenRepository.create(baseTokenData);
        token = await this.tokenRepository.save(newToken);

        // Fetch Twitter username history if available
        if (token.twitterHandle) {
          await this.twitterHistoryService.fetchAndStoreUsernameHistory(token);
        }
      } else {
        // Existing token: Track view count and check for updated socials from DexScreener
        token.viewsCount = (token.viewsCount || 0) + 1;
        await this.tokenRepository.save(token);

        // Check DexScreener for updated social links
        token = await this.updateTokenSocialLinksFromDexScreener(token);
      }

      // Add watchlist status if user is authenticated
      if (userId && this.watchlistService) {
        const isWatchlisted = await this.watchlistService.isTokenInWatchlist(
          userId,
          mintAddress,
        );
        return { ...token, isWatchlisted };
      }

      return token;
    } catch (error) {
      this.logger.error(`Error in getTokenData for ${mintAddress}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(
        `Failed to get token data for ${mintAddress}.`,
      );
    }
  }

  /**
   * Clears all API data caches
   */
  public clearCaches() {
    this.tokenOverviewCache.clear();
    this.topHoldersCache.clear();
    this.dexScreenerCache.clear();
    this.cacheTimestamps.clear();
    this.pendingRequests.clear();
  }

  async getAllTokens(): Promise<TokenEntity[]> {
    return this.tokenRepository.find();
  }

  async getTokens(mintAddresses: string[]): Promise<TokenEntity[]> {
    return this.tokenRepository.find({
      where: { mintAddress: In(mintAddresses) },
    });
  }

  async getTokenStats(mintAddress: string): Promise<TokenStats> {
    try {
      const tokenExists = await this.tokenRepository.findOne({
        where: { mintAddress: mintAddress },
        select: ['mintAddress'],
      });
      if (!tokenExists) {
        throw new NotFoundException(
          `Token with mint address ${mintAddress} not found in DB for stats`,
        );
      }
      const overviewData = await this.fetchTokenOverview(mintAddress);
      if (!overviewData) {
        throw new InternalServerErrorException(
          `Could not fetch overview data from Birdeye for token ${mintAddress}.`,
        );
      }

      const topHolders = await this.fetchTopHolders(mintAddress, overviewData);

      const decimals = overviewData.decimals ?? 0;
      const rawTotalSupply = overviewData.totalSupply ?? 0;
      const rawCirculatingSupply =
        overviewData.circulatingSupply ?? overviewData.totalSupply ?? 0; // Fallback circ to total

      const calculatedTotalSupply =
        rawTotalSupply > 0 && decimals >= 0
          ? rawTotalSupply / Math.pow(10, decimals)
          : 0;
      const calculatedCirculatingSupply =
        rawCirculatingSupply > 0 && decimals >= 0
          ? rawCirculatingSupply / Math.pow(10, decimals)
          : 0;

      const totalSupplyString = calculatedTotalSupply.toString();
      const circulatingSupplyString = calculatedCirculatingSupply.toString();

      return {
        price: overviewData.price,
        marketCap: overviewData.marketCap,
        volume24h: overviewData.v24hUSD,
        totalSupply: totalSupplyString,
        circulatingSupply: circulatingSupplyString,
        topHolders,
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Error fetching token stats for ${mintAddress}:`,
        error,
      );
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to fetch token stats for ${mintAddress}`,
      );
    }
  }

  private async fetchTopHolders(
    mintAddress: string,
    providedOverviewData?: BirdeyeTokenOverviewResponse['data'],
  ): Promise<TokenHolder[]> {
    const cacheKey = `birdeye_v3_holders_${mintAddress}`;
    const cachedData = this.topHoldersCache.get(cacheKey);
    const cachedTimestamp = this.cacheTimestamps.get(cacheKey);
    const HOLDER_CACHE_TTL = 5 * 60 * 1000;

    if (
      cachedData &&
      cachedTimestamp &&
      Date.now() - cachedTimestamp < HOLDER_CACHE_TTL
    ) {
      return cachedData;
    }
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    const requestPromise = (async (): Promise<TokenHolder[]> => {
      const apiUrl = `https://public-api.birdeye.so/defi/v3/token/holder?address=${mintAddress}&limit=10&offset=0`;
      try {
        const response = await fetch(apiUrl, {
          headers: {
            'X-API-KEY': this.configService.get('BIRDEYE_API_KEY') || '',
            'x-chain': 'solana',
          },
        });
        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ message: 'Failed to parse error JSON' }));
          const errorMessage = errorData?.message || response.statusText;
          throw new Error(
            `Birdeye Holder API error (${response.status}): ${errorMessage}`,
          );
        }
        const data: BirdeyeV3HolderResponse = await response.json();
        if (
          !data?.success ||
          !data?.data?.items ||
          data.data.items.length === 0
        ) {
          this.logger.warn(
            `Birdeye V3 holder response unsuccessful or missing data for ${mintAddress}`,
          );
          return [];
        }

        const overviewData =
          providedOverviewData || (await this.fetchTokenOverview(mintAddress));
        if (!overviewData) {
          this.logger.warn(
            `Could not get overview data for ${mintAddress} while calculating holder percentages.`,
          );
          return [];
        }
        const overviewTotalSupply = overviewData.totalSupply ?? 0;

        const mappedHolders: TokenHolder[] = data.data.items.map((item) => {
          const holderAmount = item.ui_amount;
          const percentage =
            overviewTotalSupply > 0
              ? (holderAmount / overviewTotalSupply) * 100
              : 0;

          return {
            address: item.owner,
            amount: holderAmount,
            percentage: isFinite(percentage) ? percentage : 0,
          };
        });

        this.topHoldersCache.set(cacheKey, mappedHolders);
        this.cacheTimestamps.set(cacheKey, Date.now());
        return mappedHolders;
      } catch (error) {
        this.logger.error(
          `Error fetching Birdeye V3 top holders for ${mintAddress}:`,
          error.message,
        );
        return [];
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();
    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async getTokenPriceHistory(
    mintAddress: string,
    startTime: Date,
    endTime: Date,
    resolution: '1m' | '5m' | '15m' | '30m' | '1H' | '2H' | '1D' = '1D',
  ): Promise<{ items: Array<{ unixTime: number; value: number }> }> {
    try {
      const startTimeUnix = Math.floor(startTime.getTime() / 1000);
      const endTimeUnix = Math.floor(endTime.getTime() / 1000);

      if (startTimeUnix >= endTimeUnix) {
        this.logger.warn(
          `Invalid time range for price history: startTime ${startTimeUnix} >= endTime ${endTimeUnix}`,
        );
        return { items: [] };
      }

      const apiUrl = `https://public-api.birdeye.so/defi/history_price?address=${mintAddress}&address_type=token&type=${resolution}&time_from=${startTimeUnix}&time_to=${endTimeUnix}`;

      const response = await fetch(apiUrl, {
        headers: {
          'X-API-KEY': this.configService.get('BIRDEYE_API_KEY') || '',
          'x-chain': 'solana',
        },
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: 'Failed to parse error JSON' }));
        const errorMessage = errorData?.message || response.statusText;
        const status = response.status;
        this.logger.error(
          `Birdeye API error (${status}): ${errorMessage} for ${mintAddress}`,
        );

        if (status === 429) {
          throw new Error('Rate limit exceeded fetching price history');
        }

        throw new Error(
          `Failed to fetch price data from Birdeye: ${errorMessage}`,
        );
      }

      const data = await response.json();

      if (!data?.data?.items) {
        this.logger.warn(
          `No price history items found in Birdeye response for ${mintAddress}`,
        );
        return { items: [] };
      }

      return data.data;
    } catch (error) {
      this.logger.error(
        `Error in getTokenPriceHistory for token ${mintAddress}:`,
        error,
      );
      throw error;
    }
  }
}
