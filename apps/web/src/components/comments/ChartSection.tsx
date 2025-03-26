import React from 'react';

interface ChartSectionProps {
  tokenMintAddress: string;
  width?: string;
  height?: string;
}

const ChartSection: React.FC<ChartSectionProps> = ({
  tokenMintAddress,
  width = "100%",
  height = "500px",
}) => {
  const src = `https://www.gmgn.cc/kline/sol/${tokenMintAddress}?interval=1`;

  return (
    <iframe
      src={src}
      width={width}
      height={height}
      title={`Chart for ${tokenMintAddress}`}
      style={{ border: 'none', marginBottom: '20px'}}
      allowFullScreen
    />
  );
};

export default ChartSection;
