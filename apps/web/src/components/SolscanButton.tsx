'use client';

import { ReactNode } from 'react';

interface SolscanButtonProps {
  address: string;
  className?: string;
  children?: ReactNode;
  type?: 'account' | 'token' | 'tx';
}

export function SolscanButton({
  address,
  className,
  children,
  type = 'account',
}: SolscanButtonProps) {
  const handleClick = () => {
    const baseUrl = 'https://solscan.io';
    let url;

    if (type === 'token') {
      url = `${baseUrl}/token/${address}`;
    } else if (type === 'tx') {
      url = `${baseUrl}/tx/${address}`;
    } else {
      url = `${baseUrl}/account/${address}`;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const getTooltipText = () => {
    switch (type) {
      case 'token':
        return 'View token on Solscan';
      case 'tx':
        return 'View transaction on Solscan';
      default:
        return 'View account on Solscan';
    }
  };

  const tooltipText = getTooltipText();

  // If no children are provided, render the default button
  if (!children) {
    return (
      <button
        onClick={handleClick}
        className={className || 'text-xs text-zinc-500 hover:text-zinc-300 transition-colors'}
        title={tooltipText}>
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='16'
          height='16'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'>
          <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
          <polyline points='15 3 21 3 21 9' />
          <line x1='10' y1='14' x2='21' y2='3' />
        </svg>
      </button>
    );
  }

  // If children are provided, render them with the Solscan functionality
  return (
    <button onClick={handleClick} className={`${className}`} title={tooltipText}>
      {children}
    </button>
  );
}
