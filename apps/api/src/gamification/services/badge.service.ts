import { BadgeRequirement, NotificationEventType } from '@dyor-hub/types';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  ActivityType,
  BadgeCategory,
  BadgeEntity,
  CommentEntity,
  UserActivityEntity,
  UserBadgeEntity,
  UserReputationEntity,
  UserStreakEntity,
} from '../../entities';

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(
    @InjectRepository(BadgeEntity)
    private readonly badgeRepository: Repository<BadgeEntity>,
    @InjectRepository(UserBadgeEntity)
    private readonly userBadgeRepository: Repository<UserBadgeEntity>,
    @InjectRepository(UserActivityEntity)
    private readonly userActivityRepository: Repository<UserActivityEntity>,
    @InjectRepository(UserStreakEntity)
    private readonly userStreakRepository: Repository<UserStreakEntity>,
    @InjectRepository(CommentEntity)
    private readonly commentRepository: Repository<CommentEntity>,
    @InjectRepository(UserReputationEntity)
    private readonly userReputationRepository: Repository<UserReputationEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async checkAndAwardBadges(userId: string): Promise<UserBadgeEntity[]> {
    try {
      // Get all available badges
      const badges = await this.badgeRepository.find({
        where: { isActive: true },
      });

      // Get badges that user already has
      const userBadges = await this.userBadgeRepository.find({
        where: { userId },
        relations: ['badge'],
      });

      // Find badges the user doesn't have yet
      const userBadgeIds = userBadges.map((ub) => ub.badgeId);
      const availableBadges = badges.filter(
        (badge) => !userBadgeIds.includes(badge.id),
      );

      if (availableBadges.length === 0) {
        return [];
      }

      const newlyAwardedBadges: UserBadgeEntity[] = [];

      // Check each badge requirement
      for (const badge of availableBadges) {
        const isEligible = await this.checkBadgeEligibility(userId, badge);

        if (isEligible) {
          // Award the badge
          const userBadge = this.userBadgeRepository.create({
            userId,
            badgeId: badge.id,
            earnedAt: new Date(),
          });

          await this.userBadgeRepository.save(userBadge);
          newlyAwardedBadges.push(userBadge);

          // Emit event for notification service
          this.eventEmitter.emit(NotificationEventType.BADGE_EARNED, {
            userId: userId,
            badgeId: badge.id,
            badgeName: badge.name,
          });
        }
      }

      return newlyAwardedBadges;
    } catch (error) {
      this.logger.error(
        `Failed to check and award badges for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async checkBadgeEligibility(
    userId: string,
    badge: BadgeEntity,
  ): Promise<boolean> {
    try {
      switch (badge.requirement) {
        case BadgeRequirement.CURRENT_STREAK:
          return this.checkStreakRequirement(userId, badge.thresholdValue);
        case BadgeRequirement.MAX_STREAK:
          return this.checkMaxStreakRequirement(userId, badge.thresholdValue);
        case BadgeRequirement.POSTS_COUNT:
          return this.checkActivityCountRequirement(
            userId,
            ActivityType.POST,
            badge.thresholdValue,
          );
        case BadgeRequirement.COMMENTS_COUNT:
          return this.checkActivityCountRequirement(
            userId,
            ActivityType.COMMENT,
            badge.thresholdValue,
          );
        case BadgeRequirement.UPVOTES_GIVEN_COUNT:
          return this.checkActivityCountRequirement(
            userId,
            ActivityType.UPVOTE,
            badge.thresholdValue,
          );
        case BadgeRequirement.UPVOTES_RECEIVED_COUNT:
          return this.checkUpvotesReceivedRequirement(
            userId,
            badge.thresholdValue,
          );
        case BadgeRequirement.COMMENTS_RECEIVED_COUNT:
          return this.checkCommentsReceivedRequirement(
            userId,
            badge.thresholdValue,
          );
        case BadgeRequirement.COMMENT_MIN_UPVOTES:
          return this.checkCommentMinUpvotesRequirement(
            userId,
            badge.thresholdValue,
          );
        case BadgeRequirement.POST_MIN_UPVOTES:
          return this.checkPostMinUpvotesRequirement(
            userId,
            badge.thresholdValue,
          );
        case BadgeRequirement.TOP_PERCENT_WEEKLY:
          return this.checkTopPercentWeeklyRequirement(
            userId,
            badge.thresholdValue,
          );
        default:
          this.logger.warn(
            `Unknown badge requirement: ${badge.requirement} for badge ${badge.name}`,
          );
          return false;
      }
    } catch (error) {
      this.logger.error(
        `Error checking badge eligibility for user ${userId}, badge ${badge.name}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  private async checkStreakRequirement(
    userId: string,
    requiredStreak: number,
  ): Promise<boolean> {
    const query = `
      SELECT current_streak 
      FROM user_streaks 
      WHERE user_id = $1
    `;

    const result = await this.userActivityRepository.query(query, [userId]);

    if (result.length === 0) {
      return false;
    }

    return parseInt(result[0].current_streak, 10) >= requiredStreak;
  }

  private async checkMaxStreakRequirement(
    userId: string,
    requiredStreak: number,
  ): Promise<boolean> {
    const userStreak = await this.userStreakRepository.findOne({
      where: { userId },
    });

    if (!userStreak) return false;
    return userStreak.longestStreak >= requiredStreak;
  }

  private async checkActivityCountRequirement(
    userId: string,
    activityType: ActivityType,
    requiredCount: number,
  ): Promise<boolean> {
    const count = await this.userActivityRepository.count({
      where: {
        userId,
        activityType,
      },
    });

    return count >= requiredCount;
  }

  private async checkUpvotesReceivedRequirement(
    userId: string,
    requiredCount: number,
  ): Promise<boolean> {
    const result = await this.commentRepository
      .createQueryBuilder('comment')
      .leftJoin('comment.votes', 'votes', 'votes.type = :voteType', {
        voteType: 'upvote',
      })
      .where('comment.userId = :userId', { userId })
      .select('COUNT(votes.id)', 'upvoteCount')
      .getRawOne();

    return result && parseInt(result.upvoteCount, 10) >= requiredCount;
  }

  private async checkCommentsReceivedRequirement(
    userId: string,
    requiredCount: number,
  ): Promise<boolean> {
    const result = await this.commentRepository
      .createQueryBuilder('comment')
      .where(
        'comment.parentId IN (SELECT id FROM comment WHERE userId = :userId)',
        { userId },
      )
      .select('COUNT(comment.id)', 'replyCount')
      .getRawOne();

    return result && parseInt(result.replyCount, 10) >= requiredCount;
  }

  private async checkCommentMinUpvotesRequirement(
    userId: string,
    minUpvotes: number,
  ): Promise<boolean> {
    const result = await this.commentRepository
      .createQueryBuilder('comment')
      .where('comment.userId = :userId', { userId })
      .andWhere('comment.upvotes >= :minUpvotes', { minUpvotes })
      .getCount();

    return result > 0;
  }

  private async checkPostMinUpvotesRequirement(
    userId: string,
    minUpvotes: number,
  ): Promise<boolean> {
    try {
      // Use comments that represent top-level posts (without a parent)
      // and have enough upvotes
      const posts = await this.commentRepository
        .createQueryBuilder('comment')
        .where('comment.userId = :userId', { userId })
        .andWhere('comment.parentId IS NULL') // Only top-level comments (posts)
        .andWhere('comment.upvotes >= :minUpvotes', { minUpvotes })
        .getCount();

      return posts > 0;
    } catch (error) {
      this.logger.error(
        `Error checking post min upvotes requirement: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  private async checkTopPercentWeeklyRequirement(
    userId: string,
    percentThreshold: number,
  ): Promise<boolean> {
    try {
      // Get start of current week (Monday)
      const now = new Date();
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
      startOfWeek.setDate(diff);
      startOfWeek.setHours(0, 0, 0, 0);

      // Step 1: Check weekly reputation ranking
      const weeklyUserReputations = await this.userReputationRepository.find({
        where: {
          weeklyPoints: MoreThanOrEqual(1), // Only users with some weekly points
        },
        order: {
          weeklyPoints: 'DESC',
        },
      });

      if (weeklyUserReputations.length === 0) {
        return false;
      }

      // Calculate percentile ranking based on reputation
      const totalUsers = weeklyUserReputations.length;
      const userRepIndex = weeklyUserReputations.findIndex(
        (rep) => rep.userId === userId,
      );

      if (userRepIndex === -1) {
        return false; // User not found in the rankings
      }

      const repPercentile = (userRepIndex / totalUsers) * 100;

      // Step 2: Check for engagement on user's content this week
      // Get all comments by user created this week
      const userComments = await this.commentRepository.find({
        where: {
          userId,
          createdAt: MoreThanOrEqual(startOfWeek),
        },
      });

      if (userComments.length === 0) {
        return false; // No comments created this week
      }

      // Sum upvotes on content created this week
      const weeklyUpvotes = userComments.reduce(
        (sum, comment) => sum + comment.upvotes,
        0,
      );

      // Get average upvotes per content
      const avgUpvotesPerContent = weeklyUpvotes / userComments.length;

      // Get all other users' comments created this week
      const allWeeklyComments = await this.commentRepository.find({
        where: {
          createdAt: MoreThanOrEqual(startOfWeek),
        },
      });

      // Group comments by users to calculate their average
      const userUpvoteAverages = new Map<
        string,
        { total: number; count: number }
      >();

      allWeeklyComments.forEach((comment) => {
        if (!userUpvoteAverages.has(comment.userId)) {
          userUpvoteAverages.set(comment.userId, { total: 0, count: 0 });
        }
        const stats = userUpvoteAverages.get(comment.userId)!;
        stats.total += comment.upvotes;
        stats.count++;
      });

      // Convert to array of average upvotes per content
      const averageUpvotes = Array.from(userUpvoteAverages.entries())
        .map(([uid, stats]) => ({
          userId: uid,
          average: stats.count > 0 ? stats.total / stats.count : 0,
        }))
        .filter((item) => item.average > 0) // Only include users with some upvotes
        .sort((a, b) => b.average - a.average); // Sort by highest average first

      // Calculate upvote percentile
      const userUpvoteIndex = averageUpvotes.findIndex(
        (item) => item.userId === userId,
      );

      if (userUpvoteIndex === -1 || averageUpvotes.length === 0) {
        return false; // User not found or no valid data
      }

      const upvotePercentile = (userUpvoteIndex / averageUpvotes.length) * 100;

      // Final decision: User must be in top X% for either reputation or upvotes
      return (
        repPercentile <= percentThreshold ||
        upvotePercentile <= percentThreshold
      );
    } catch (error) {
      this.logger.error(
        `Error checking top percent requirement for user ${userId}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  async getUserBadges(userId: string): Promise<UserBadgeEntity[]> {
    try {
      return this.userBadgeRepository.find({
        where: { userId },
        relations: ['badge'],
        order: { earnedAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get badges for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async toggleBadgeDisplay(
    userId: string,
    badgeId: string,
    isDisplayed: boolean,
  ): Promise<UserBadgeEntity> {
    try {
      const userBadge = await this.userBadgeRepository.findOne({
        where: {
          userId,
          badgeId,
        },
      });

      if (!userBadge) {
        throw new Error(
          `User badge not found for user ${userId} and badge ${badgeId}`,
        );
      }

      userBadge.isDisplayed = isDisplayed;
      return this.userBadgeRepository.save(userBadge);
    } catch (error) {
      this.logger.error(
        `Failed to toggle badge display for user ${userId}, badge ${badgeId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getAllBadgeCategories(): Promise<BadgeCategory[]> {
    return Object.values(BadgeCategory);
  }

  async getBadgesByCategory(category: BadgeCategory): Promise<BadgeEntity[]> {
    try {
      return this.badgeRepository.find({
        where: { category, isActive: true },
        order: { thresholdValue: 'ASC' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get badges for category ${category}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getAvailableBadges(userId: string): Promise<
    {
      category: BadgeCategory;
      badges: Array<BadgeEntity & { earned: boolean; progress?: number }>;
    }[]
  > {
    try {
      // Get all active badges
      const badges = await this.badgeRepository.find({
        where: { isActive: true },
        order: { category: 'ASC', thresholdValue: 'ASC' },
      });

      // Get badges that user already has
      const userBadges = await this.userBadgeRepository.find({
        where: { userId },
      });
      const earnedBadgeIds = userBadges.map((ub) => ub.badgeId);

      // Group badges by category
      const badgesByCategory = badges.reduce(
        (result, badge) => {
          const earned = earnedBadgeIds.includes(badge.id);
          const category = badge.category;

          if (!result[category]) {
            result[category] = [];
          }

          // Clone the badge and add earned status
          result[category].push({
            ...badge,
            earned,
          });

          return result;
        },
        {} as Record<
          BadgeCategory,
          Array<BadgeEntity & { earned: boolean; progress?: number }>
        >,
      );

      // Calculate progress for unearnedBadges
      for (const category in badgesByCategory) {
        for (const badge of badgesByCategory[category]) {
          if (!badge.earned) {
            badge.progress = await this.calculateBadgeProgress(userId, badge);
          }
        }
      }

      // Transform to array format
      return Object.entries(badgesByCategory).map(([category, badges]) => ({
        category: category as BadgeCategory,
        badges,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get available badges for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async calculateBadgeProgress(
    userId: string,
    badge: BadgeEntity,
  ): Promise<number> {
    try {
      let current = 0;
      const target = badge.thresholdValue;

      switch (badge.requirement) {
        case BadgeRequirement.CURRENT_STREAK: {
          const query = `
            SELECT current_streak 
            FROM user_streaks 
            WHERE user_id = $1
          `;
          const result = await this.userActivityRepository.query(query, [
            userId,
          ]);
          current =
            result.length > 0 ? parseInt(result[0].current_streak, 10) : 0;
          break;
        }
        case BadgeRequirement.POSTS_COUNT:
          current = await this.userActivityRepository.count({
            where: { userId, activityType: ActivityType.POST },
          });
          break;
        case BadgeRequirement.COMMENTS_COUNT:
          current = await this.userActivityRepository.count({
            where: { userId, activityType: ActivityType.COMMENT },
          });
          break;
        case BadgeRequirement.UPVOTES_GIVEN_COUNT:
          current = await this.userActivityRepository.count({
            where: { userId, activityType: ActivityType.UPVOTE },
          });
          break;
        case BadgeRequirement.POST_MIN_UPVOTES: {
          // Get max upvotes on any top-level comment (post)
          const result = await this.commentRepository
            .createQueryBuilder('comment')
            .where('comment.userId = :userId', { userId })
            .andWhere('comment.parentId IS NULL') // Only top-level comments
            .orderBy('comment.upvotes', 'DESC')
            .select('MAX(comment.upvotes)', 'maxUpvotes')
            .getRawOne();

          current =
            result && result.maxUpvotes ? parseInt(result.maxUpvotes, 10) : 0;
          break;
        }
        case BadgeRequirement.COMMENT_MIN_UPVOTES: {
          // Get max upvotes on any comment
          const result = await this.commentRepository
            .createQueryBuilder('comment')
            .where('comment.userId = :userId', { userId })
            .orderBy('comment.upvotes', 'DESC')
            .select('MAX(comment.upvotes)', 'maxUpvotes')
            .getRawOne();

          current =
            result && result.maxUpvotes ? parseInt(result.maxUpvotes, 10) : 0;
          break;
        }
        case BadgeRequirement.TOP_PERCENT_WEEKLY: {
          // For TOP_PERCENT_WEEKLY, we'll show progress based on reputation ranking
          const now = new Date();
          const startOfWeek = new Date(now);
          const day = startOfWeek.getDay();
          const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
          startOfWeek.setDate(diff);
          startOfWeek.setHours(0, 0, 0, 0);

          // Get user's weekly reputation
          const userRep = await this.userReputationRepository.findOne({
            where: { userId },
          });

          if (!userRep) return 0;

          // Get all users with some weekly points
          const reputations = await this.userReputationRepository.find({
            where: {
              weeklyPoints: MoreThanOrEqual(1),
            },
            order: {
              weeklyPoints: 'DESC',
            },
          });

          if (reputations.length === 0) return 0;

          // Find user's position
          const userIndex = reputations.findIndex((r) => r.userId === userId);
          if (userIndex === -1) return 0;

          // Calculate percentile (lower is better)
          const percentile = (userIndex / reputations.length) * 100;

          // Convert to progress (100 - percentile ensures higher percentages for better ranks)
          // If target is 5% (top 5%), then being in top 1% would be 100% progress
          // Being in top 10% would be 50% progress toward top 5% goal
          return Math.min(100, Math.round((target / percentile) * 100));
        }
        default:
          return 0;
      }

      // Calculate percentage (0-100)
      return Math.min(100, Math.round((current / target) * 100));
    } catch (error) {
      this.logger.error(
        `Error calculating badge progress: ${error.message}`,
        error.stack,
      );
      return 0;
    }
  }

  async getUserBadgeSummary(userId: string): Promise<{
    totalBadges: number;
    recentBadges: UserBadgeEntity[];
    badgesByCategory: Record<BadgeCategory, number>;
  }> {
    try {
      const userBadges = await this.userBadgeRepository.find({
        where: { userId },
        relations: ['badge'],
        order: { earnedAt: 'DESC' },
      });

      const badgesByCategory = userBadges.reduce(
        (acc, userBadge) => {
          const category = userBadge.badge.category;
          acc[category] = (acc[category] || 0) + 1;
          return acc;
        },
        {} as Record<BadgeCategory, number>,
      );

      return {
        totalBadges: userBadges.length,
        recentBadges: userBadges.slice(0, 5),
        badgesByCategory,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get user badge summary for ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
