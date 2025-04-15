import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CommentVoteEntity } from '../entities/comment-vote.entity';
import { CommentEntity } from '../entities/comment.entity';
import { TokenWatchlistEntity } from '../entities/token-watchlist.entity';
import { UserBadgeEntity } from '../entities/user-badge.entity';
import { UserReputationEntity } from '../entities/user-reputation.entity';
import { UserStreakEntity } from '../entities/user-streak.entity';
import { UserEntity } from '../entities/user.entity';
import { TokenCallsModule } from '../token-calls/token-calls.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      CommentEntity,
      CommentVoteEntity,
      TokenWatchlistEntity,
      UserStreakEntity,
      UserReputationEntity,
      UserBadgeEntity,
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => TokenCallsModule),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
