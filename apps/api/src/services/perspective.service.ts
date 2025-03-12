import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AttributeScores {
  SPAM: {
    spanScores: Array<{ begin: number; end: number; score: { value: number } }>;
    summaryScore: { value: number };
  };
  TOXICITY: {
    spanScores: Array<{ begin: number; end: number; score: { value: number } }>;
    summaryScore: { value: number };
  };
}

interface AnalyzeResponse {
  attributeScores: AttributeScores;
  languages: string[];
}

@Injectable()
export class PerspectiveService {
  private readonly logger = new Logger(PerspectiveService.name);
  private readonly apiKey: string;
  private readonly apiEndpoint =
    'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';
  private readonly threshold = {
    spam: 0.85,
    toxicity: 0.8,
  };
  private readonly urlRegex = /https?:\/\/[^\s]+/;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('PERSPECTIVE_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('PERSPECTIVE_API_KEY is not set');
    }
  }

  async analyzeText(text: string): Promise<{
    isSpam: boolean;
    isToxic: boolean;
    scores: { spam: number; toxicity: number };
  }> {
    // Skip spam check for short comments or URLs
    if (text.trim().length <= 3 || this.urlRegex.test(text)) {
      if (!this.apiKey) {
        return {
          isSpam: false,
          isToxic: false,
          scores: { spam: 0, toxicity: 0 },
        };
      }

      // For short comments, only check toxicity
      try {
        const clientUrl = this.configService.get('CLIENT_URL');

        const response = await fetch(`${this.apiEndpoint}?key=${this.apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: clientUrl,
            Referer: clientUrl,
          },
          body: JSON.stringify({
            comment: { text },
            languages: ['en'],
            requestedAttributes: {
              TOXICITY: {},
            },
            doNotStore: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`Perspective API error: ${response.statusText}`);
        }

        const data = (await response.json()) as AnalyzeResponse;
        const toxicityScore = data.attributeScores.TOXICITY.summaryScore.value;

        return {
          isSpam: false, // URLs/short texts exempt from spam check
          isToxic: toxicityScore > this.threshold.toxicity,
          scores: {
            spam: 0,
            toxicity: toxicityScore,
          },
        };
      } catch (error) {
        this.logger.error('Error analyzing text with Perspective API', error);
        return {
          isSpam: false,
          isToxic: false,
          scores: { spam: 0, toxicity: 0 },
        };
      }
    }

    if (!this.apiKey) {
      this.logger.warn('Skipping content analysis - API key not configured');
      return {
        isSpam: false,
        isToxic: false,
        scores: { spam: 0, toxicity: 0 },
      };
    }

    try {
      const clientUrl = this.configService.get('CLIENT_URL');

      const response = await fetch(`${this.apiEndpoint}?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: clientUrl,
          Referer: clientUrl,
        },
        body: JSON.stringify({
          comment: { text },
          languages: ['en'],
          requestedAttributes: {
            SPAM: {},
            TOXICITY: {},
          },
          doNotStore: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Perspective API error: ${response.status} ${response.statusText}`,
          errorText,
        );

        if (response.status === 403) {
          this.logger.error(
            'API key might not be properly configured or activated. Please check the Google Cloud Console and ensure the referrer is allowed.',
            {
              clientUrl,
            },
          );
        }

        throw new Error(`Perspective API error: ${response.statusText}`);
      }

      const data = (await response.json()) as AnalyzeResponse;

      const spamScore = data.attributeScores.SPAM.summaryScore.value;
      const toxicityScore = data.attributeScores.TOXICITY.summaryScore.value;

      return {
        isSpam: spamScore > this.threshold.spam,
        isToxic: toxicityScore > this.threshold.toxicity,
        scores: {
          spam: spamScore,
          toxicity: toxicityScore,
        },
      };
    } catch (error) {
      this.logger.error('Error analyzing text with Perspective API', error);
      // Graceful degradation - allow content if API fails
      return {
        isSpam: false,
        isToxic: false,
        scores: { spam: 0, toxicity: 0 },
      };
    }
  }
}
