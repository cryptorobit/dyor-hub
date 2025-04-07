'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIntersectionObserver } from '@/hooks/use-intersection-observer';
import { useToast } from '@/hooks/use-toast';
import { gamification, notifications } from '@/lib/api';
import { sanitizeHtml } from '@/lib/utils';
import { useAuthContext } from '@/providers/auth-provider';
import { NotificationItem, NotificationType } from '@dyor-hub/types';
import { formatDistanceToNow } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Check, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface ServerToClientEvents {
  new_notification: (notification: NotificationItem) => void;
  update_unread_count: (count: number) => void;
}

type ClientToServerEvents = Record<string, never>;

export function NotificationBell() {
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [notificationData, setNotificationData] = useState<{
    notifications: NotificationItem[];
    unreadCount: number;
  }>({ notifications: [], unreadCount: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuthContext();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [processingNotifications, setProcessingNotifications] = useState<Set<string>>(new Set());
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const isProcessing = (id: string) => processingNotifications.has(id);

  const startProcessing = (id: string) => {
    setProcessingNotifications((prev) => {
      const newSet = new Set(prev);
      newSet.add(id);
      return newSet;
    });
  };

  const stopProcessing = (id: string) => {
    setProcessingNotifications((prev) => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const fetchNotifications = useCallback(async (page: number) => {
    const pageSize = 10;
    return notifications.getPaginatedNotifications(page, pageSize);
  }, []);

  const loadMoreNotifications = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const data = await fetchNotifications(nextPage);

      setNotificationData((prev) => ({
        ...prev,
        notifications: [...prev.notifications, ...data.notifications],
      }));
      setCurrentPage(nextPage);
      setHasMore(
        data.notifications.length > 0 && (data.meta?.page ?? 1) < (data.meta?.totalPages ?? 1),
      );
    } catch (err) {
      console.error('Failed to load more notifications:', err);
      toast({ variant: 'destructive', description: 'Could not load more notifications.' });
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentPage, fetchNotifications, hasMore, isLoadingMore, toast]);

  useEffect(() => {
    if (!isAuthenticated) return;
    setIsInitialLoading(true);
    fetchNotifications(1)
      .then((data) => {
        setNotificationData({
          notifications: data.notifications,
          unreadCount: data.unreadCount,
        });
        setCurrentPage(1);
        setHasMore((data.meta?.page ?? 1) < (data.meta?.totalPages ?? 1));
      })
      .catch(() => {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load notifications',
        });
      })
      .finally(() => {
        setIsInitialLoading(false);
      });
  }, [isAuthenticated, fetchNotifications, toast]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      return;
    }

    const socketUrl = process.env.NEXT_PUBLIC_API_URL || 'https://localhost:3001';
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
      `${socketUrl}/notifications`,
      {
        withCredentials: true,
        transports: ['websocket'],
      },
    );

    socket.on('connect', () => {
      console.log(
        'WebSocket connected (using cookie credentials). Fetching initial notifications...',
      );
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from Notifications WebSocket:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket Connection Error:', error);
    });

    socket.on('new_notification', (newNotification) => {
      setNotificationData((prev) => ({
        notifications: [newNotification, ...prev.notifications],
        unreadCount: prev.unreadCount + 1,
      }));
    });

    socket.on('update_unread_count', (count) => {
      setNotificationData((prev) => ({
        ...prev,
        unreadCount: count,
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, fetchNotifications]);

  useEffect(() => {
    const hasBadgeNotification = notificationData.notifications.some(
      (notification) => notification.type === NotificationType.BADGE_EARNED && !notification.isRead,
    );

    if (hasBadgeNotification) {
      gamification.badges.clearBadgesCache();
    }
  }, [notificationData.notifications]);

  const handleMarkAsRead = async (id: string) => {
    if (isProcessing(id)) return;

    startProcessing(id);
    try {
      await notifications.markAsRead(id);

      setNotificationData((prev) => {
        const updatedNotifications = prev.notifications.filter(
          (notification) => notification.id !== id,
        );

        return {
          notifications: updatedNotifications,
          unreadCount: prev.unreadCount > 0 ? prev.unreadCount - 1 : 0,
        };
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to mark notification as read',
      });
    } finally {
      stopProcessing(id);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (isMarkingAll) return;

    setIsMarkingAll(true);
    try {
      await notifications.markAllAsRead();

      setNotificationData((prev) => ({
        notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }));
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to mark all notifications as read',
      });
    } finally {
      setIsMarkingAll(false);
    }
  };

  const getNotificationLink = (notification: NotificationItem): string => {
    switch (notification.type) {
      case NotificationType.COMMENT_REPLY:
      case NotificationType.UPVOTE_RECEIVED:
        const mintAddress = notification.relatedMetadata?.tokenMintAddress;
        if (mintAddress && notification.relatedEntityId) {
          return `/tokens/${mintAddress}/comments/${notification.relatedEntityId}`;
        } else if (notification.relatedEntityId) {
          console.warn(
            `Missing tokenMintAddress in metadata for comment notification ${notification.id}`,
          );
          return '#';
        }
        return '/';

      case NotificationType.BADGE_EARNED:
        gamification.badges.clearBadgesCache();
        return `/account/badges`;

      case NotificationType.STREAK_ACHIEVED:
      case NotificationType.STREAK_AT_RISK:
      case NotificationType.STREAK_BROKEN:
        return '/account/streak';

      case NotificationType.LEADERBOARD_CHANGE:
        return '/leaderboard';

      case NotificationType.REPUTATION_MILESTONE:
        return '/account';

      case NotificationType.SYSTEM:
        return '#';

      default:
        return '/';
    }
  };

  const getTimeAgo = (dateString: string | Date): string => {
    try {
      const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return '';
    }
  };

  useIntersectionObserver({
    target: loadMoreRef,
    onIntersect: loadMoreNotifications,
    enabled: isOpen && hasMore && !isLoadingMore,
  });

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='relative h-9 w-9 text-zinc-400 hover:text-white'>
          <Bell className='h-5 w-5' />
          {notificationData.unreadCount > 0 && (
            <Badge
              variant='destructive'
              className='absolute -top-1 -right-1 flex items-center justify-center min-h-[18px] min-w-[18px] text-[10px] px-[5px] py-0 rounded-full bg-red-600 hover:bg-red-600 border-0 font-semibold shadow-md shadow-red-900/20 animate-pulse'>
              {notificationData.unreadCount > 99 ? '99+' : notificationData.unreadCount}
            </Badge>
          )}
          <span className='sr-only'>Notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='w-80 md:w-96 bg-zinc-900 border-zinc-700 shadow-xl max-h-[70vh] overflow-hidden flex flex-col'>
        <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-700'>
          <h3 className='text-sm font-semibold text-white'>Notifications</h3>
          {notificationData.notifications.length > 0 && (
            <Button
              variant='link'
              size='sm'
              className='text-xs text-sky-400 hover:text-sky-300 px-0 h-auto disabled:opacity-50'
              onClick={handleMarkAllAsRead}
              disabled={isMarkingAll || notificationData.unreadCount === 0}>
              {isMarkingAll ? (
                <Loader2 className='h-3 w-3 animate-spin mr-1' />
              ) : (
                <Check className='h-3 w-3 mr-1' />
              )}
              Mark all as read
            </Button>
          )}
        </div>

        <div
          ref={scrollContainerRef}
          className='flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-zinc-800/30'>
          {isInitialLoading ? (
            <div className='p-4 text-center text-zinc-400 text-xs'>Loading...</div>
          ) : notificationData.notifications.length === 0 ? (
            <div className='p-4 text-center text-zinc-400 text-xs'>No notifications yet.</div>
          ) : (
            <AnimatePresence initial={false}>
              {notificationData.notifications.map((notification) => (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className='flex items-start gap-3 px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors'>
                  <div className='flex-1 overflow-hidden'>
                    <Link
                      href={getNotificationLink(notification)}
                      className='block group'
                      onClick={() => {
                        handleMarkAsRead(notification.id);
                        setIsOpen(false);
                      }}>
                      <p className='text-xs text-zinc-200 leading-snug mb-0.5 group-hover:text-sky-300 transition-colors truncate'>
                        {sanitizeHtml(notification.message)}
                      </p>
                      <p className='text-[10px] text-zinc-400'>
                        {getTimeAgo(notification.createdAt)}
                      </p>
                    </Link>
                  </div>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6 text-zinc-500 hover:text-red-500 hover:bg-red-900/20 rounded disabled:opacity-50 flex-shrink-0'
                    onClick={() => handleMarkAsRead(notification.id)}
                    disabled={isProcessing(notification.id)}
                    aria-label='Mark notification as read'>
                    {isProcessing(notification.id) ? (
                      <Loader2 className='h-3 w-3 animate-spin' />
                    ) : (
                      <X className='h-3 w-3' />
                    )}
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}

          <div ref={loadMoreRef} className='h-10 flex items-center justify-center'>
            {isLoadingMore && <Loader2 className='h-4 w-4 animate-spin text-zinc-500' />}
            {!hasMore && notificationData.notifications.length > 0 && (
              <span className='text-xs text-zinc-500'>No more notifications</span>
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
