'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatPrice } from '@/lib/utils';
import { TokenCall, TokenCallStatus } from '@dyor-hub/types';
import { format, formatDistanceStrict } from 'date-fns';
import { ArrowUp, Calendar, Clock, DollarSign, Target, TrendingUp } from 'lucide-react';

interface DisplayUserCallProps {
  call: TokenCall;
  currentTokenPrice?: number;
}

export function DisplayUserCall({ call, currentTokenPrice = 0 }: DisplayUserCallProps) {
  const formatRatio = (ratio: number | undefined | null) =>
    ratio ? `${(ratio * 100).toFixed(1)}%` : 'N/A';

  const getStatusColor = () => {
    switch (call.status) {
      case TokenCallStatus.VERIFIED_SUCCESS:
        return 'green';
      case TokenCallStatus.VERIFIED_FAIL:
        return 'red';
      case TokenCallStatus.PENDING:
        return 'amber';
      default:
        return 'gray';
    }
  };

  const statusColor = getStatusColor();
  const isPriceUp = call.targetPrice > call.referencePrice;

  const percentChange = ((call.targetPrice - call.referencePrice) / call.referencePrice) * 100;
  const formattedPercentChange = isPriceUp
    ? `+${percentChange.toFixed(2)}%`
    : `${percentChange.toFixed(2)}%`;

  const hasValidCurrentPrice = currentTokenPrice > 0;
  const distanceToTarget = hasValidCurrentPrice
    ? ((call.targetPrice - currentTokenPrice) / currentTokenPrice) * 100
    : 0;
  const isGettingCloser =
    hasValidCurrentPrice &&
    ((isPriceUp && currentTokenPrice > call.referencePrice) ||
      (!isPriceUp && currentTokenPrice < call.referencePrice));
  const formattedDistance = hasValidCurrentPrice
    ? `${Math.abs(distanceToTarget).toFixed(2)}%`
    : 'N/A';

  return (
    <div className='relative group'>
      <div
        className={cn(
          'absolute -inset-0.5 rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-300',
          call.status === TokenCallStatus.VERIFIED_SUCCESS &&
            'bg-gradient-to-r from-green-500 to-green-600',
          call.status === TokenCallStatus.VERIFIED_FAIL &&
            'bg-gradient-to-r from-red-500 to-red-600',
          call.status === TokenCallStatus.PENDING && 'bg-gradient-to-r from-amber-500 to-amber-600',
          call.status === TokenCallStatus.ERROR && 'bg-gradient-to-r from-zinc-500 to-zinc-600',
        )}></div>
      <Card className='relative rounded-2xl bg-zinc-900/80 backdrop-blur-sm border-0'>
        <CardHeader className='pb-2 flex flex-row items-center justify-between space-y-0 px-3'>
          <div className='flex items-center'>
            <div
              className={`h-8 w-8 rounded-lg bg-${statusColor}-500/10 flex items-center justify-center mr-2`}>
              <TrendingUp className={`h-4 w-4 text-${statusColor}-400`} />
            </div>
            <CardTitle className='text-base font-medium'>Your Prediction</CardTitle>
          </div>
          <Badge
            variant={call.status === TokenCallStatus.VERIFIED_FAIL ? 'destructive' : 'default'}
            className={cn(
              'rounded-md',
              call.status === TokenCallStatus.VERIFIED_SUCCESS &&
                'bg-green-500/20 text-green-300 hover:bg-green-500/30',
              call.status === TokenCallStatus.PENDING &&
                'bg-amber-500/20 text-amber-300 hover:bg-amber-500/20',
              call.status === TokenCallStatus.ERROR &&
                'bg-zinc-500/20 text-zinc-300 hover:bg-zinc-500/30',
            )}>
            {call.status.replace('VERIFIED_', '')}
          </Badge>
        </CardHeader>
        <CardContent className='pt-0 pb-4 px-3'>
          <div className='space-y-4'>
            <div className='bg-zinc-800/50 rounded-lg p-3 mt-3 text-center'>
              <div className='flex items-center justify-center gap-2 mb-1'>
                <ArrowUp
                  className={`h-4 w-4 ${isPriceUp ? 'text-green-400 rotate-0' : 'text-red-400 rotate-180'}`}
                />
                <span
                  className={`text-sm font-medium ${isPriceUp ? 'text-green-400' : 'text-red-400'}`}>
                  {formattedPercentChange}
                </span>
              </div>
              <div className='text-xl font-bold text-white'>${formatPrice(call.targetPrice)}</div>
              <div className='text-xs text-zinc-400 mt-1'>Target Price</div>
            </div>

            <div className='grid grid-cols-2 gap-2 text-sm'>
              <div className='space-y-3'>
                <div className='flex items-start'>
                  <Calendar className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                  <div>
                    <div className='text-xs text-zinc-500'>Target Date</div>
                    <div className='font-medium text-zinc-300 text-xs'>
                      {format(new Date(call.targetDate), 'MMM d, yyyy')}
                    </div>
                  </div>
                </div>

                <div className='flex items-start'>
                  <DollarSign className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                  <div>
                    <div className='text-xs text-zinc-500'>Reference Price</div>
                    <div className='font-medium text-zinc-300'>
                      ${formatPrice(call.referencePrice)}
                    </div>
                  </div>
                </div>
              </div>

              <div className='space-y-3'>
                <div className='flex items-start'>
                  <Clock className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                  <div>
                    <div className='text-xs text-zinc-500'>Call Placed</div>
                    <div className='font-medium text-zinc-300 text-xs'>
                      {formatDistanceStrict(new Date(call.callTimestamp), new Date()) + ' ago'}
                    </div>
                  </div>
                </div>

                <div className='flex items-start'>
                  <Target className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                  <div>
                    <div className='text-xs text-zinc-500'>Target Distance</div>
                    <div
                      className={cn(
                        'font-medium text-xs',
                        !hasValidCurrentPrice && 'text-zinc-300',
                        hasValidCurrentPrice && isGettingCloser && 'text-green-300',
                        hasValidCurrentPrice && !isGettingCloser && 'text-red-300',
                      )}>
                      {hasValidCurrentPrice
                        ? distanceToTarget > 0
                          ? `+${formattedDistance}`
                          : `-${formattedDistance}`
                        : 'No current price'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {(call.status === TokenCallStatus.VERIFIED_SUCCESS ||
              call.status === TokenCallStatus.VERIFIED_FAIL) && (
              <div className='mt-4 pt-3 border-t border-zinc-800/50'>
                <div className='text-sm font-medium text-zinc-300 mb-2'>Results</div>
                <div className='grid grid-cols-2 gap-2 text-sm'>
                  <div className='flex items-start'>
                    <Target className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                    <div>
                      <div className='text-xs text-zinc-500'>Peak Price</div>
                      <div className='font-medium text-zinc-300'>
                        ${formatPrice(call.peakPriceDuringPeriod)}
                      </div>
                    </div>
                  </div>

                  {call.status === TokenCallStatus.VERIFIED_SUCCESS && call.targetHitTimestamp && (
                    <div className='flex items-start'>
                      <Clock className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                      <div>
                        <div className='text-xs text-zinc-500'>Target Hit</div>
                        <div className='font-medium text-zinc-300 text-xs'>
                          {formatDistanceStrict(new Date(call.targetHitTimestamp), new Date()) +
                            ' ago'}
                        </div>
                      </div>
                    </div>
                  )}

                  {call.status === TokenCallStatus.VERIFIED_SUCCESS &&
                    call.timeToHitRatio !== null && (
                      <div className='flex items-start'>
                        <Clock className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                        <div>
                          <div className='text-xs text-zinc-500'>Time to Hit</div>
                          <div className='font-medium text-zinc-300'>
                            {formatRatio(call.timeToHitRatio)} of timeframe
                          </div>
                        </div>
                      </div>
                    )}

                  {call.status === TokenCallStatus.VERIFIED_FAIL && (
                    <div className='flex items-start'>
                      <DollarSign className='h-4 w-4 text-zinc-400 mt-0.5 mr-2 flex-shrink-0' />
                      <div>
                        <div className='text-xs text-zinc-500'>Final Price</div>
                        <div className='font-medium text-zinc-300'>
                          ${formatPrice(call.finalPriceAtTargetDate)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
