import { NotificationType } from '@dyor-hub/types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('notifications')
@Index(['userId', 'isRead', 'createdAt'])
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ name: 'related_entity_id', type: 'varchar', nullable: true })
  relatedEntityId: string | null;

  @Column({ name: 'related_entity_type', type: 'varchar', nullable: true })
  relatedEntityType: string | null;

  @Column({ type: 'jsonb', nullable: true })
  relatedMetadata: Record<string, any> | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
